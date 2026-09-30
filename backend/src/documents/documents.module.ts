import { Logger, Module } from '@nestjs/common';
import type { AppConfig } from '../config/env';
import { APP_CONFIG, DATABASE } from '../config/tokens';
import type { Database } from '../database/client';
import { CLOCK, type Clock } from '../shared-kernel/clock';
import { ID_GENERATOR, type IdGenerator } from '../shared-kernel/id-generator';
import { FailDocument } from './application/fail-document';
import { GetDocument } from './application/get-document';
import { GetDocumentsByIds } from './application/get-documents-by-ids';
import { ProcessDocument } from './application/process-document';
import { UploadDocument } from './application/upload-document';
import type { WorkLogger } from './application/document-failure';
import { PrefixChunkingStrategy } from './domain/prefix-chunking';
import {
  CHUNKING_STRATEGY,
  DOCUMENT_REPOSITORY,
  EVENT_PUBLISHER,
  FILE_STORAGE,
  JOB_QUEUE,
  TEXT_EXTRACTOR,
  UNIT_OF_WORK,
  type ChunkingStrategy,
  type DocumentRepository,
  type EventPublisher,
  type FileStorage,
  type JobQueuePort,
  type TextExtractorPort,
  type UnitOfWork,
} from './domain/ports';
import { DrizzleDocumentRepository } from './infrastructure/drizzle-document-repository';
import { CompositeTextExtractor } from './infrastructure/extractors/composite-text-extractor';
import { PdfTextExtractor } from './infrastructure/extractors/pdf-text-extractor';
import { PlainTextExtractor } from './infrastructure/extractors/plain-text-extractor';
import { DocumentsController } from './interface/documents.controller';
import { IndexingWorker } from './interface/indexing-worker';
import { UploadInterceptor } from './interface/upload.interceptor';

function nestWorkLogger(context: string): WorkLogger {
  const logger = new Logger(context);
  return {
    info: (message) => logger.log(message),
    warn: (message) => logger.warn(message),
    error: (message) => logger.error(message),
  };
}

/**
 * Composicion del modulo: los casos de uso son clases simples sin decoradores de Nest y se
 * ensamblan aqui, de modo que la capa de aplicacion solo depende del dominio.
 */
@Module({
  controllers: [DocumentsController],
  providers: [
    UploadInterceptor,
    {
      provide: DOCUMENT_REPOSITORY,
      inject: [DATABASE],
      useFactory: (database: Database) => new DrizzleDocumentRepository(database),
    },
    IndexingWorker,
    { provide: TEXT_EXTRACTOR, useFactory: () => new CompositeTextExtractor([new PlainTextExtractor(), new PdfTextExtractor()]) },
    { provide: CHUNKING_STRATEGY, useFactory: () => new PrefixChunkingStrategy() },
    {
      provide: ProcessDocument,
      inject: [
        DOCUMENT_REPOSITORY,
        UNIT_OF_WORK,
        FILE_STORAGE,
        TEXT_EXTRACTOR,
        EVENT_PUBLISHER,
        CHUNKING_STRATEGY,
        CLOCK,
        APP_CONFIG,
      ],
      useFactory: (
        repository: DocumentRepository,
        unitOfWork: UnitOfWork,
        storage: FileStorage,
        extractor: TextExtractorPort,
        events: EventPublisher,
        chunking: ChunkingStrategy,
        clock: Clock,
        config: AppConfig,
      ) =>
        new ProcessDocument(
          repository,
          unitOfWork,
          storage,
          extractor,
          events,
          chunking,
          clock,
          {
            maxPages: config.maxPdfPages,
            maxChars: config.maxExtractedChars,
            timeoutMs: config.extractionTimeoutMs,
            maxIndexableChars: config.maxIndexableChars,
          },
          nestWorkLogger('ProcessDocument'),
        ),
    },
    {
      provide: FailDocument,
      inject: [DOCUMENT_REPOSITORY, UNIT_OF_WORK, EVENT_PUBLISHER, CLOCK],
      useFactory: (repository: DocumentRepository, unitOfWork: UnitOfWork, events: EventPublisher, clock: Clock) =>
        new FailDocument(repository, unitOfWork, events, clock, nestWorkLogger('FailDocument')),
    },
    {
      provide: GetDocument,
      inject: [DOCUMENT_REPOSITORY],
      useFactory: (repository: DocumentRepository) => new GetDocument(repository),
    },
    {
      provide: GetDocumentsByIds,
      inject: [DOCUMENT_REPOSITORY],
      useFactory: (repository: DocumentRepository) => new GetDocumentsByIds(repository),
    },
    {
      provide: UploadDocument,
      inject: [DOCUMENT_REPOSITORY, UNIT_OF_WORK, FILE_STORAGE, JOB_QUEUE, CLOCK, ID_GENERATOR, APP_CONFIG],
      useFactory: (
        repository: DocumentRepository,
        unitOfWork: UnitOfWork,
        storage: FileStorage,
        queue: JobQueuePort,
        clock: Clock,
        ids: IdGenerator,
        config: AppConfig,
      ) => {
        const logger = new Logger('UploadDocument');
        return new UploadDocument(
          repository,
          unitOfWork,
          storage,
          queue,
          clock,
          ids,
          { maxBytesText: config.maxUploadBytesText, maxBytesPdf: config.maxUploadBytesPdf },
          { warn: (message) => logger.warn(message) },
        );
      },
    },
  ],
  exports: [DOCUMENT_REPOSITORY],
})
export class DocumentsModule {}
