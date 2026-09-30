import type { DocumentAccepted, UploadMetadata } from '@kata/shared';
import type { Clock } from '../../shared-kernel/clock';
import {
  DuplicateDocumentError,
  EmptyFileError,
  FileRequiredError,
  FileTooLargeError,
} from '../../shared-kernel/errors';
import type { IdGenerator } from '../../shared-kernel/id-generator';
import { Document } from '../domain/document';
import { detectFormat } from '../domain/file-type';
import type {
  DocumentRepository,
  FileStorage,
  JobQueuePort,
  UnitOfWork,
} from '../domain/ports';
import { DuplicateFingerprintError } from '../domain/processing-error';

export interface UploadedFile {
  tempPath: string;
  originalName: string;
  sizeBytes: number;
  sha256: string;
  head: Buffer;
}

export interface UploadDocumentCommand {
  metadata: UploadMetadata;
  file: UploadedFile | undefined;
}

export interface UploadLimits {
  maxBytesText: number;
  maxBytesPdf: number;
}

export interface UploadLogger {
  warn(message: string): void;
}

const NOOP_LOGGER: UploadLogger = { warn: () => undefined };

/**
 * Caso de uso de la carga (HU-01, ADR-08): valida, guarda el archivo, y en una sola
 * transaccion registra el documento y encola su procesamiento. Responde sin procesar.
 */
export class UploadDocument {
  constructor(
    private readonly repository: DocumentRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly storage: FileStorage,
    private readonly queue: JobQueuePort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly limits: UploadLimits,
    private readonly logger: UploadLogger = NOOP_LOGGER,
  ) {}

  async execute(command: UploadDocumentCommand): Promise<DocumentAccepted> {
    const file = command.file;
    if (!file) throw new FileRequiredError();
    if (file.sizeBytes === 0) throw new EmptyFileError();

    const format = detectFormat(file.head, file.originalName);

    const limit = format === 'PDF' ? this.limits.maxBytesPdf : this.limits.maxBytesText;
    if (file.sizeBytes > limit) throw new FileTooLargeError(limit);

    const existing = await this.repository.findRefByFileSha256(file.sha256);
    if (existing) throw new DuplicateDocumentError(existing);

    const document = Document.create({
      ...command.metadata,
      version: command.metadata.version ?? null,
      id: this.ids.newId(),
      format,
      originalFilename: file.originalName,
      sizeBytes: file.sizeBytes,
      fileSha256: file.sha256,
      createdAt: this.clock.now(),
    });

    // El archivo se guarda antes de la transaccion, con compensacion si esta falla (ADR-08).
    await this.storage.commitTemp(file.tempPath, document.id);

    try {
      await this.unitOfWork.run(async (ctx) => {
        await this.repository.insert(ctx, document);
        await this.queue.enqueueIndexing(ctx, document.id);
      });
    } catch (error) {
      await this.compensate(document.id);
      if (error instanceof DuplicateFingerprintError) {
        const winner = await this.repository.findRefByFileSha256(file.sha256);
        if (winner) throw new DuplicateDocumentError(winner);
      }
      throw error;
    }

    return { id: document.id, status: 'PROCESANDO' };
  }

  private async compensate(documentId: string): Promise<void> {
    try {
      await this.storage.remove(documentId);
    } catch (error) {
      // Un archivo huerfano ocupa espacio pero no afecta a la busqueda ni al visor (ADR-08).
      this.logger.warn(
        `No se pudo eliminar el archivo ${documentId} tras un fallo de la transaccion: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
