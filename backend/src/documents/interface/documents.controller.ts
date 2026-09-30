import {
  idsQuerySchema,
  toFieldErrors,
  uploadMetadataSchema,
  type DocumentAccepted,
  type DocumentDetail,
  type DocumentStatusList,
} from '@kata/shared';
import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { DocumentNotFoundError, InvalidQueryError, ValidationFailedError } from '../../shared-kernel/errors';
import { GetDocument } from '../application/get-document';
import { GetDocumentsByIds } from '../application/get-documents-by-ids';
import { UploadDocument } from '../application/upload-document';
import { FILE_STORAGE, type FileStorage } from '../domain/ports';
import { STORED_UPLOAD_KEY, type StoredUpload } from './hashing-storage-engine';
import { UploadInterceptor } from './upload.interceptor';

const documentIdSchema = z.uuid();

@Controller('documents')
export class DocumentsController {
  constructor(
    @Inject(UploadDocument) private readonly uploadDocument: UploadDocument,
    @Inject(GetDocument) private readonly getDocument: GetDocument,
    @Inject(GetDocumentsByIds) private readonly getDocumentsByIds: GetDocumentsByIds,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(UploadInterceptor)
  async upload(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<DocumentAccepted> {
    const file = (req.file as unknown as Record<string, StoredUpload | undefined> | undefined)?.[STORED_UPLOAD_KEY];
    try {
      const parsed = uploadMetadataSchema.safeParse({ ...(req.body as Record<string, unknown> | undefined) });
      if (!parsed.success) throw new ValidationFailedError(toFieldErrors(parsed.error));

      const accepted = await this.uploadDocument.execute({ metadata: parsed.data, file });
      res.setHeader('Location', `/api/documents/${accepted.id}`);
      return accepted;
    } finally {
      // Si el archivo ya se movio a su destino definitivo, el descarte no encuentra nada y no hace nada.
      if (file) await this.storage.discardTemp(file.tempPath).catch(() => undefined);
    }
  }

  /** Estado de varios documentos para reconciliar tras una reconexion (ADR-07). */
  @Get()
  async statuses(@Query() rawQuery: Record<string, unknown>): Promise<DocumentStatusList> {
    const parsed = idsQuerySchema.safeParse({ ...rawQuery });
    if (!parsed.success) throw new InvalidQueryError(toFieldErrors(parsed.error));
    return this.getDocumentsByIds.execute(parsed.data.ids);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<DocumentDetail> {
    // Un identificador con formato invalido no puede existir: se trata como inexistente.
    if (!documentIdSchema.safeParse(id).success) throw new DocumentNotFoundError();
    return this.getDocument.execute(id);
  }
}
