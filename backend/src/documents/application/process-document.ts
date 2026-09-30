import type { Clock } from '../../shared-kernel/clock';
import type {
  ChunkingStrategy,
  DocumentRepository,
  EventPublisher,
  ExtractionLimits,
  FileStorage,
  TextExtractorPort,
  UnitOfWork,
} from '../domain/ports';
import { DocumentProcessingError, IndexLimitError, truncateDetail } from '../domain/processing-error';
import { DocumentFailureRecorder, NOOP_WORK_LOGGER, type WorkLogger } from './document-failure';

export interface ProcessLimits extends ExtractionLimits {
  maxIndexableChars: number;
}

/** Veces que se reduce a la mitad el prefijo indexable si el vector supera el limite (E-34). */
export const MAX_PREFIX_HALVINGS = 3;

/**
 * Caso de uso del worker (ADR-08): extrae el texto sin transaccion abierta y luego, en una sola
 * transaccion corta, guarda el contenido, marca INDEXADO y emite el evento. Es idempotente:
 * un documento que ya no esta en PROCESANDO se ignora (E-14).
 *
 * Un fallo permanente marca ERROR y completa el trabajo. Un fallo transitorio se registra y se
 * relanza para que la cola reintente.
 */
export class ProcessDocument {
  private readonly failures: DocumentFailureRecorder;

  constructor(
    private readonly repository: DocumentRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly storage: FileStorage,
    private readonly extractor: TextExtractorPort,
    private readonly events: EventPublisher,
    private readonly chunking: ChunkingStrategy,
    private readonly clock: Clock,
    private readonly limits: ProcessLimits,
    private readonly logger: WorkLogger = NOOP_WORK_LOGGER,
  ) {
    this.failures = new DocumentFailureRecorder(repository, unitOfWork, events, clock);
  }

  async execute(documentId: string): Promise<void> {
    const candidate = await this.repository.findProcessingCandidate(documentId);
    if (!candidate) {
      this.logger.warn(`documentId=${documentId} el documento no existe; se descarta el trabajo`);
      return;
    }
    if (candidate.status !== 'PROCESANDO') {
      this.logger.info(`documentId=${documentId} ya esta en ${candidate.status}; no se procesa de nuevo`);
      return;
    }

    let text: string;
    try {
      const data = await this.storage.read(documentId);
      text = await this.extractor.extract(candidate.format, data, this.limits);
    } catch (error) {
      await this.handleFailure(documentId, error);
      return;
    }

    await this.index(documentId, text);
  }

  private async index(documentId: string, text: string): Promise<void> {
    let maxChars = this.limits.maxIndexableChars;

    for (let halvings = 0; ; halvings += 1) {
      const plan = this.chunking.plan(text, maxChars);
      try {
        const saved = await this.unitOfWork.run(async (ctx) => {
          const changed = await this.repository.saveIndexedContent(
            ctx,
            documentId,
            { content: text, totalChars: plan.totalChars, indexedChars: plan.indexedChars },
            this.clock.now(),
          );
          if (changed) {
            await this.events.publishStatusChange(ctx, {
              documentId,
              status: 'INDEXADO',
              occurredAt: this.clock.now().toISOString(),
            });
          }
          return changed;
        });
        if (!saved) {
          this.logger.info(`documentId=${documentId} otro proceso ya resolvio el documento; se descarta el resultado`);
        }
        return;
      } catch (error) {
        if (error instanceof IndexLimitError) {
          if (halvings >= MAX_PREFIX_HALVINGS) {
            await this.failPermanently(documentId, 'INDEX_LIMIT_EXCEEDED', 'El vector de busqueda supera el limite permitido');
            return;
          }
          maxChars = Math.floor(plan.indexedChars / 2);
          this.logger.warn(`documentId=${documentId} el vector supera el limite; se reintenta con ${maxChars} caracteres`);
          continue;
        }
        await this.handleFailure(documentId, error);
        return;
      }
    }
  }

  private async handleFailure(documentId: string, error: unknown): Promise<void> {
    if (error instanceof DocumentProcessingError && error.permanent) {
      await this.failPermanently(documentId, error.code, error.safeDetail);
      return;
    }

    const code = error instanceof DocumentProcessingError ? error.code : 'PROCESSING_FAILED';
    const detail =
      error instanceof DocumentProcessingError
        ? error.safeDetail
        : `Fallo transitorio al procesar (${error instanceof Error ? error.name : 'desconocido'})`;
    this.logger.error(
      `documentId=${documentId} fallo transitorio ${code}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );

    // El registro del intento no debe ocultar el error original ni impedir el reintento.
    try {
      await this.repository.recordAttemptFailure(documentId, {
        code,
        detail: truncateDetail(detail),
        at: this.clock.now(),
      });
    } catch (recordError) {
      this.logger.warn(
        `documentId=${documentId} no se pudo registrar el intento fallido: ${
          recordError instanceof Error ? recordError.message : String(recordError)
        }`,
      );
    }
    throw error;
  }

  private async failPermanently(documentId: string, code: DocumentProcessingError['code'], detail: string): Promise<void> {
    const changed = await this.failures.markAsFailed(documentId, code, detail);
    this.logger.warn(
      changed
        ? `documentId=${documentId} marcado como ERROR (${code})`
        : `documentId=${documentId} otro proceso ya resolvio el documento; no se marca ERROR`,
    );
  }
}
