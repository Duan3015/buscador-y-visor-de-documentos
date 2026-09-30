import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import type { StorageEngine } from 'multer';
import { FileTooLargeError } from '../../shared-kernel/errors';
import { HEAD_SAMPLE_BYTES } from '../domain/file-type';
import type { FileStorage } from '../domain/ports';
import type { UploadedFile, UploadLimits } from '../application/upload-document';

export interface StoredUpload extends UploadedFile {}

/** Campo donde el motor deja el resultado dentro del objeto de archivo de multer. */
export const STORED_UPLOAD_KEY = 'storedUpload';

/**
 * Motor de multer: transmite el archivo a disco sin cargarlo en memoria (ADR-05), calcula el SHA-256
 * al pasar y conserva solo los primeros bytes para detectar el tipo real (ADR-10).
 * El limite de tamano depende de la extension: los PDF tienen un tope mayor que el texto.
 */
export class HashingStorageEngine implements StorageEngine {
  constructor(
    private readonly storage: FileStorage,
    private readonly limits: UploadLimits,
  ) {}

  _handleFile(
    _req: Request,
    file: Express.Multer.File,
    callback: (error?: unknown, info?: Partial<Express.Multer.File>) => void,
  ): void {
    const tempPath = this.storage.createTempPath();
    const limit = file.originalname.toLowerCase().endsWith('.pdf')
      ? this.limits.maxBytesPdf
      : this.limits.maxBytesText;

    const hash = createHash('sha256');
    const headChunks: Buffer[] = [];
    let headLength = 0;
    let size = 0;

    const meter = new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
        size += chunk.length;
        if (size > limit) {
          done(new FileTooLargeError(limit));
          return;
        }
        hash.update(chunk);
        if (headLength < HEAD_SAMPLE_BYTES) {
          const part = chunk.subarray(0, HEAD_SAMPLE_BYTES - headLength);
          headChunks.push(part);
          headLength += part.length;
        }
        done(null, chunk);
      },
    });

    pipeline(file.stream, meter, createWriteStream(tempPath)).then(
      () => {
        const stored: StoredUpload = {
          tempPath,
          originalName: file.originalname,
          sizeBytes: size,
          sha256: hash.digest('hex'),
          head: Buffer.concat(headChunks),
        };
        callback(null, { [STORED_UPLOAD_KEY]: stored } as Partial<Express.Multer.File>);
      },
      (error: unknown) => {
        // Si el flujo fallo o se supero el limite, el temporal parcial se elimina.
        this.storage.discardTemp(tempPath).finally(() => callback(error));
      },
    );
  }

  _removeFile(_req: Request, file: Express.Multer.File, callback: (error: Error | null) => void): void {
    const stored = (file as unknown as Record<string, StoredUpload | undefined>)[STORED_UPLOAD_KEY];
    if (!stored) {
      callback(null);
      return;
    }
    this.storage.discardTemp(stored.tempPath).then(
      () => callback(null),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
    );
  }
}
