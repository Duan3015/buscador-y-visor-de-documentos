import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import type { Observable } from 'rxjs';
import type { AppConfig } from '../../config/env';
import { APP_CONFIG } from '../../config/tokens';
import { FILE_STORAGE, type FileStorage } from '../domain/ports';
import { HashingStorageEngine } from './hashing-storage-engine';

const FILE_FIELD = 'file';
const MAX_TEXT_FIELDS = 8;
const MAX_FIELD_BYTES = 16 * 1024;

/**
 * Procesa el multipart antes del controlador. Los limites de multer (un solo archivo, pocos campos,
 * campos acotados) protegen la API; el limite de tamano por formato lo aplica el motor.
 */
@Injectable()
export class UploadInterceptor implements NestInterceptor {
  private readonly handler: RequestHandler;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(FILE_STORAGE) storage: FileStorage,
  ) {
    const engine = new HashingStorageEngine(storage, {
      maxBytesText: config.maxUploadBytesText,
      maxBytesPdf: config.maxUploadBytesPdf,
    });
    this.handler = multer({
      storage: engine,
      limits: {
        files: 1,
        fields: MAX_TEXT_FIELDS,
        fieldSize: MAX_FIELD_BYTES,
        parts: MAX_TEXT_FIELDS + 1,
        fileSize: Math.max(config.maxUploadBytesText, config.maxUploadBytesPdf),
      },
    }).single(FILE_FIELD);
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    await new Promise<void>((resolve, reject) => {
      this.handler(req, res, (error?: unknown) => (error ? reject(error) : resolve()));
    });
    return next.handle();
  }
}
