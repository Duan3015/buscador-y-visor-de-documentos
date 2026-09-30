import type {
  DocumentDetail,
  DocumentErrorCode,
  DocumentStatus,
  DocumentStatusEvent,
  DocumentStatusItem,
} from '@kata/shared';
import type { Clock } from '../../shared-kernel/clock';
import type { IdGenerator } from '../../shared-kernel/id-generator';
import type { Document } from '../domain/document';
import type {
  ChunkingStrategy,
  DeadLetterInfo,
  DocumentRef,
  DocumentRepository,
  ErrorDocumentSummary,
  EventPublisher,
  ExtractionLimits,
  FailureRecord,
  FileStorage,
  IndexedContentInput,
  IndexPlan,
  JobHandlers,
  JobQueuePort,
  ProcessingCandidate,
  PurgeFilter,
  TextExtractorPort,
  TransactionContext,
  UnitOfWork,
} from '../domain/ports';
import { DuplicateFingerprintError, IndexLimitError } from '../domain/processing-error';
import type { DocumentFormat } from '@kata/shared';

export class FixedClock implements Clock {
  constructor(public current: Date = new Date('2026-09-29T12:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current);
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;
  newId(): string {
    this.counter += 1;
    return `00000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`;
  }
}

interface StoredDocument {
  document: Document;
  status: DocumentStatus;
  lastErrorCode: DocumentErrorCode | null;
  lastErrorDetail: string | null;
  attempts: number;
  content: IndexedContentInput | null;
}

/** Contexto de transaccion falso: sirve para verificar que las operaciones comparten transaccion. */
export class FakeTransactionContext implements TransactionContext {
  readonly brand = 'TransactionContext' as const;
  constructor(readonly id: number) {}
}

export class InMemoryDocumentRepository implements DocumentRepository {
  readonly documents = new Map<string, StoredDocument>();
  insertContexts: TransactionContext[] = [];
  /** Si se define, el proximo saveIndexedContent lanza IndexLimitError esa cantidad de veces. */
  indexLimitFailures = 0;
  /** Errores forzados para simular fallos de la base de datos. */
  saveError: Error | null = null;
  markFailedError: Error | null = null;
  recordAttemptError: Error | null = null;
  savedContents: IndexedContentInput[] = [];

  snapshot(): Map<string, StoredDocument> {
    return new Map([...this.documents].map(([id, value]) => [id, { ...value }]));
  }

  restore(snapshot: Map<string, StoredDocument>): void {
    this.documents.clear();
    for (const [id, value] of snapshot) this.documents.set(id, value);
  }

  async insert(ctx: TransactionContext, document: Document): Promise<void> {
    for (const stored of this.documents.values()) {
      if (stored.document.props.fileSha256 === document.props.fileSha256) {
        throw new DuplicateFingerprintError();
      }
    }
    this.insertContexts.push(ctx);
    this.documents.set(document.id, {
      document,
      status: 'PROCESANDO',
      lastErrorCode: null,
      lastErrorDetail: null,
      attempts: 0,
      content: null,
    });
  }

  async findRefByFileSha256(fileSha256: string): Promise<DocumentRef | null> {
    for (const stored of this.documents.values()) {
      if (stored.document.props.fileSha256 === fileSha256) {
        return { id: stored.document.id, status: stored.status };
      }
    }
    return null;
  }

  async findProcessingCandidate(id: string): Promise<ProcessingCandidate | null> {
    const stored = this.documents.get(id);
    if (!stored) return null;
    return { id, format: stored.document.props.format, status: stored.status };
  }

  async saveIndexedContent(
    _ctx: TransactionContext,
    id: string,
    input: IndexedContentInput,
  ): Promise<boolean> {
    if (this.saveError) throw this.saveError;
    if (this.indexLimitFailures > 0) {
      this.indexLimitFailures -= 1;
      throw new IndexLimitError();
    }
    const stored = this.documents.get(id);
    if (!stored || stored.status !== 'PROCESANDO') return false;
    stored.status = 'INDEXADO';
    stored.lastErrorCode = null;
    stored.lastErrorDetail = null;
    stored.content = input;
    this.savedContents.push(input);
    return true;
  }

  async markFailed(_ctx: TransactionContext, id: string, failure: FailureRecord): Promise<boolean> {
    if (this.markFailedError) throw this.markFailedError;
    const stored = this.documents.get(id);
    if (!stored || stored.status !== 'PROCESANDO') return false;
    stored.status = 'ERROR';
    stored.lastErrorCode = failure.code;
    stored.lastErrorDetail = failure.detail;
    if (failure.countAttempt !== false) stored.attempts += 1;
    return true;
  }

  async recordAttemptFailure(id: string, failure: FailureRecord): Promise<void> {
    if (this.recordAttemptError) throw this.recordAttemptError;
    const stored = this.documents.get(id);
    if (!stored) return;
    stored.lastErrorCode = failure.code;
    stored.lastErrorDetail = failure.detail;
    stored.attempts += 1;
  }

  async findLastErrorCode(id: string): Promise<DocumentErrorCode | null> {
    return this.documents.get(id)?.lastErrorCode ?? null;
  }

  async findDetailById(_id: string): Promise<DocumentDetail | null> {
    return null;
  }

  async findStatusesByIds(ids: string[]): Promise<DocumentStatusItem[]> {
    const items: DocumentStatusItem[] = [];
    for (const id of ids) {
      const stored = this.documents.get(id);
      if (stored) items.push({ id, status: stored.status, errorCode: stored.lastErrorCode });
    }
    return items;
  }

  async listErrorDocuments(filter: PurgeFilter): Promise<ErrorDocumentSummary[]> {
    const result: ErrorDocumentSummary[] = [];
    for (const stored of this.documents.values()) {
      if (stored.status !== 'ERROR' || !stored.lastErrorCode) continue;
      if (filter.code && stored.lastErrorCode !== filter.code) continue;
      result.push({
        id: stored.document.id,
        title: stored.document.props.title,
        code: stored.lastErrorCode,
        lastErrorAt: null,
      });
    }
    return result;
  }

  async deleteErrorDocument(id: string): Promise<boolean> {
    const stored = this.documents.get(id);
    if (!stored || stored.status !== 'ERROR') return false;
    this.documents.delete(id);
    return true;
  }

  get(id: string): StoredDocument {
    const stored = this.documents.get(id);
    if (!stored) throw new Error(`Documento ${id} no encontrado en el repositorio falso`);
    return stored;
  }
}

/** Unidad de trabajo falsa con reversion: si el trabajo falla, se restauran los repositorios. */
export class InMemoryUnitOfWork implements UnitOfWork {
  private counter = 0;
  constructor(private readonly restorables: { snapshot(): unknown; restore(snapshot: never): void }[]) {}

  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    this.counter += 1;
    const snapshots = this.restorables.map((r) => r.snapshot());
    try {
      return await work(new FakeTransactionContext(this.counter));
    } catch (error) {
      this.restorables.forEach((r, index) => r.restore(snapshots[index] as never));
      throw error;
    }
  }
}

export class InMemoryFileStorage implements FileStorage {
  readonly temps = new Set<string>();
  readonly files = new Map<string, Buffer>();
  events: string[] = [];
  removeFails = false;
  private counter = 0;

  createTempPath(): string {
    this.counter += 1;
    const path = `tmp-${this.counter}`;
    this.temps.add(path);
    return path;
  }

  async commitTemp(tempPath: string, documentId: string): Promise<void> {
    this.events.push(`commit:${documentId}`);
    this.temps.delete(tempPath);
    this.files.set(documentId, Buffer.from(tempPath));
  }

  async discardTemp(tempPath: string): Promise<void> {
    this.temps.delete(tempPath);
  }

  async remove(documentId: string): Promise<void> {
    this.events.push(`remove:${documentId}`);
    if (this.removeFails) throw new Error('fallo al eliminar');
    this.files.delete(documentId);
  }

  async read(documentId: string): Promise<Buffer> {
    const data = this.files.get(documentId);
    if (!data) throw new Error(`Archivo ${documentId} no existe`);
    return data;
  }
}

export class FakeJobQueue implements JobQueuePort {
  readonly enqueued: { ctx: TransactionContext; documentId: string }[] = [];
  enqueueError: Error | null = null;
  handlers: JobHandlers | null = null;
  started = false;

  async start(): Promise<void> {
    this.started = true;
  }

  async enqueueIndexing(ctx: TransactionContext, documentId: string): Promise<void> {
    if (this.enqueueError) throw this.enqueueError;
    this.enqueued.push({ ctx, documentId });
  }

  async consume(handlers: JobHandlers): Promise<void> {
    this.handlers = handlers;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  deadLetter(info: DeadLetterInfo): Promise<void> {
    if (!this.handlers) throw new Error('Sin consumidores');
    return this.handlers.onDeadLetter(info);
  }
}

export class FakeEventPublisher implements EventPublisher {
  readonly events: { ctx: TransactionContext; event: DocumentStatusEvent }[] = [];
  async publishStatusChange(ctx: TransactionContext, event: DocumentStatusEvent): Promise<void> {
    this.events.push({ ctx, event });
  }
}

export class FakeTextExtractor implements TextExtractorPort {
  calls: { format: DocumentFormat; limits: ExtractionLimits }[] = [];
  constructor(public behavior: (format: DocumentFormat, data: Buffer) => Promise<string> | string = (_f, d) => d.toString('utf8')) {}

  async extract(format: DocumentFormat, data: Buffer, limits: ExtractionLimits): Promise<string> {
    this.calls.push({ format, limits });
    return this.behavior(format, data);
  }
}

export class FixedChunkingStrategy implements ChunkingStrategy {
  plan(text: string, maxIndexableChars: number): IndexPlan {
    return { totalChars: text.length, indexedChars: Math.min(text.length, maxIndexableChars) };
  }
}
