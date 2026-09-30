import type {
  DocumentDetail,
  DocumentErrorCode,
  DocumentFormat,
  DocumentStatus,
  DocumentStatusEvent,
  DocumentStatusItem,
} from '@kata/shared';
import type { Document } from './document';

export const DOCUMENT_REPOSITORY = Symbol('DocumentRepository');
export const UNIT_OF_WORK = Symbol('UnitOfWork');
export const FILE_STORAGE = Symbol('FileStorage');
export const TEXT_EXTRACTOR = Symbol('TextExtractorPort');
export const JOB_QUEUE = Symbol('JobQueuePort');
export const EVENT_PUBLISHER = Symbol('EventPublisher');
export const CHUNKING_STRATEGY = Symbol('ChunkingStrategy');

/** Contexto de transaccion opaco: el dominio no conoce el cliente de base de datos (ADR-09). */
export interface TransactionContext {
  readonly brand: 'TransactionContext';
}

export interface UnitOfWork {
  run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T>;
}

export interface DocumentRef {
  id: string;
  status: DocumentStatus;
}

/** Datos minimos del documento que necesita el worker para procesarlo. */
export interface ProcessingCandidate {
  id: string;
  format: DocumentFormat;
  status: DocumentStatus;
}

export interface IndexedContentInput {
  content: string;
  totalChars: number;
  indexedChars: number;
}

export interface FailureRecord {
  code: DocumentErrorCode;
  detail: string;
  at: Date;
  /**
   * Si es false, markFailed no suma un intento (el fallo ya se conto en recordAttemptFailure).
   * Por defecto se cuenta.
   */
  countAttempt?: boolean;
}

export interface PurgeFilter {
  code?: DocumentErrorCode;
  olderThan?: Date;
}

export interface ErrorDocumentSummary {
  id: string;
  title: string;
  code: DocumentErrorCode;
  lastErrorAt: Date | null;
}

export interface DocumentRepository {
  /** Inserta el documento. Lanza DuplicateFingerprintError si la huella ya existe (E-33). */
  insert(ctx: TransactionContext, document: Document): Promise<void>;
  findRefByFileSha256(fileSha256: string): Promise<DocumentRef | null>;
  findProcessingCandidate(id: string): Promise<ProcessingCandidate | null>;
  /**
   * Guarda el contenido, calcula el vector y pasa PROCESANDO a INDEXADO en la misma transaccion.
   * Devuelve false si el documento ya no estaba en PROCESANDO (transicion condicionada, E-39).
   * Lanza IndexLimitError si el vector supera el limite de PostgreSQL (E-34).
   */
  saveIndexedContent(
    ctx: TransactionContext,
    id: string,
    input: IndexedContentInput,
    at: Date,
  ): Promise<boolean>;
  /** Pasa PROCESANDO a ERROR con su causa. Devuelve false si otro proceso ya lo resolvio. */
  markFailed(ctx: TransactionContext, id: string, failure: FailureRecord): Promise<boolean>;
  /** Registra el fallo de un intento sin cambiar el estado (fallo transitorio). */
  recordAttemptFailure(id: string, failure: FailureRecord): Promise<void>;
  findLastErrorCode(id: string): Promise<DocumentErrorCode | null>;
  findDetailById(id: string): Promise<DocumentDetail | null>;
  findStatusesByIds(ids: string[]): Promise<DocumentStatusItem[]>;
  listErrorDocuments(filter: PurgeFilter): Promise<ErrorDocumentSummary[]>;
  /** Elimina solo si el documento sigue en ERROR en la misma sentencia (ADR-06). */
  deleteErrorDocument(id: string): Promise<boolean>;
}

export interface FileStorage {
  createTempPath(): string;
  /** Mueve el archivo temporal a su destino con un renombrado atomico (E-43). */
  commitTemp(tempPath: string, documentId: string): Promise<void>;
  /** Elimina un temporal. Es idempotente. */
  discardTemp(tempPath: string): Promise<void>;
  /** Elimina el archivo definitivo (compensacion). Es idempotente. */
  remove(documentId: string): Promise<void>;
  read(documentId: string): Promise<Buffer>;
}

export interface ExtractionLimits {
  maxPages: number;
  maxChars: number;
  timeoutMs: number;
}

export interface TextExtractorPort {
  /** Devuelve el texto normalizado. Lanza DocumentProcessingError si no puede extraerlo. */
  extract(format: DocumentFormat, data: Buffer, limits: ExtractionLimits): Promise<string>;
}

export interface IndexingJob {
  documentId: string;
}

export interface DeadLetterInfo {
  documentId: string;
  retryCount: number | null;
}

export interface JobHandlers {
  onIndex(job: IndexingJob): Promise<void>;
  onDeadLetter(job: DeadLetterInfo): Promise<void>;
}

export interface JobQueuePort {
  /** Crea las colas si no existen y deja la cola lista para encolar. */
  start(): Promise<void>;
  /** Encola el trabajo de indexacion en la misma transaccion que el documento (ADR-04). */
  enqueueIndexing(ctx: TransactionContext, documentId: string): Promise<void>;
  /** Registra los consumidores (rol worker). */
  consume(handlers: JobHandlers): Promise<void>;
  stop(): Promise<void>;
}

export interface EventPublisher {
  /** Emite el evento dentro de la transaccion: solo se entrega si esta confirma (ADR-07). */
  publishStatusChange(ctx: TransactionContext, event: DocumentStatusEvent): Promise<void>;
}

/** Las cantidades van en caracteres Unicode (puntos de codigo), como `left()` de PostgreSQL. */
export interface IndexPlan {
  totalChars: number;
  indexedChars: number;
}

/** Punto de extension hacia chunks (ADR-03): hoy un solo fragmento con tope. */
export interface ChunkingStrategy {
  plan(text: string, maxIndexableChars: number): IndexPlan;
}
