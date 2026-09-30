import { sql } from 'drizzle-orm';
import { dynamicImport } from '../../shared-kernel/dynamic-import';
import type {
  DeadLetterInfo,
  IndexingJob,
  JobHandlers,
  JobQueuePort,
  TransactionContext,
} from '../domain/ports';
import { transactionOf } from './drizzle-unit-of-work';

export const INDEX_QUEUE = 'documents.index';
export const DEAD_LETTER_QUEUE = 'documents.index.dlq';

/** Intervalo de sondeo de los consumidores: acota la latencia entre la carga y el inicio del procesamiento. */
const POLL_SECONDS = 1;

export interface JobQueueConfig {
  databaseUrl: string;
  /** Conexiones que pg-boss puede usar para sus propias consultas. */
  poolSize: number;
  workerConcurrency: number;
  retryLimit: number;
  retryDelaySeconds: number;
  extractionTimeoutMs: number;
}

interface BossJob {
  data: { documentId?: unknown };
  retryCount?: number;
  sourceRetryCount?: number | null;
}

/** Subconjunto de la API de pg-boss que usa el adaptador. */
interface BossLike {
  on(event: 'error', listener: (error: Error) => void): unknown;
  start(): Promise<unknown>;
  stop(options?: { graceful?: boolean; timeout?: number }): Promise<void>;
  createQueue(name: string, options?: Record<string, unknown>): Promise<void>;
  updateQueue(name: string, options?: Record<string, unknown>): Promise<void>;
  send(name: string, data: object, options?: Record<string, unknown>): Promise<string | null>;
  work(name: string, options: Record<string, unknown>, handler: (jobs: BossJob[]) => Promise<void>): Promise<string>;
}

interface PgBossModule {
  PgBoss: new (options: Record<string, unknown>) => BossLike;
  fromDrizzle: (tx: unknown, sqlTag: unknown) => unknown;
}

export interface QueueLogger {
  error(message: string): void;
}

const NOOP_LOGGER: QueueLogger = { error: () => undefined };

/**
 * Cola sobre pg-boss (ADR-04): el trabajo se encola dentro de la transaccion del documento,
 * con reintentos con retroceso exponencial y una cola de mensajes muertos.
 */
export class PgBossJobQueue implements JobQueuePort {
  private boss: BossLike | null = null;
  private module: PgBossModule | null = null;

  constructor(
    private readonly config: JobQueueConfig,
    private readonly logger: QueueLogger = NOOP_LOGGER,
  ) {}

  async start(): Promise<void> {
    if (this.boss) return;
    const module = await dynamicImport<PgBossModule>('pg-boss');
    const boss = new module.PgBoss({
      connectionString: this.config.databaseUrl,
      max: this.config.poolSize,
      application_name: 'kata-documents',
    });
    boss.on('error', (error) => this.logger.error(`pg-boss: ${error.message}`));
    await boss.start();

    // La cola de mensajes muertos debe existir antes de la cola que la referencia.
    const deadLetterOptions = { retentionSeconds: 30 * 24 * 3600 };
    const indexOptions = {
      retryLimit: this.config.retryLimit,
      retryDelay: this.config.retryDelaySeconds,
      retryBackoff: true,
      // Un trabajo que excede el plazo de extraccion se considera perdido y se reintenta.
      expireInSeconds: Math.ceil(this.config.extractionTimeoutMs / 1000) + 30,
      deadLetter: DEAD_LETTER_QUEUE,
    };
    await boss.createQueue(DEAD_LETTER_QUEUE, deadLetterOptions);
    await boss.createQueue(INDEX_QUEUE, indexOptions);
    // createQueue no modifica una cola existente: se sincroniza para que un cambio de
    // configuracion (reintentos, plazos) surta efecto al reiniciar.
    await boss.updateQueue(DEAD_LETTER_QUEUE, deadLetterOptions);
    await boss.updateQueue(INDEX_QUEUE, indexOptions);

    this.module = module;
    this.boss = boss;
  }

  async enqueueIndexing(ctx: TransactionContext, documentId: string): Promise<void> {
    const { boss, module } = this.ready();
    const job: IndexingJob = { documentId };
    const id = await boss.send(INDEX_QUEUE, job, { db: module.fromDrizzle(transactionOf(ctx), sql) });
    if (id === null) {
      throw new Error('La cola rechazo el trabajo de indexacion');
    }
  }

  async consume(handlers: JobHandlers): Promise<void> {
    const { boss } = this.ready();

    await boss.work(
      INDEX_QUEUE,
      { localConcurrency: this.config.workerConcurrency, batchSize: 1, includeMetadata: true, pollingIntervalSeconds: POLL_SECONDS },
      async (jobs) => {
        for (const job of jobs) {
          await handlers.onIndex({ documentId: readDocumentId(job) });
        }
      },
    );

    await boss.work(
      DEAD_LETTER_QUEUE,
      { localConcurrency: 1, batchSize: 1, includeMetadata: true, pollingIntervalSeconds: POLL_SECONDS },
      async (jobs) => {
        for (const job of jobs) {
          const info: DeadLetterInfo = {
            documentId: readDocumentId(job),
            retryCount: job.sourceRetryCount ?? null,
          };
          await handlers.onDeadLetter(info);
        }
      },
    );
  }

  async stop(): Promise<void> {
    if (!this.boss) return;
    const boss = this.boss;
    this.boss = null;
    this.module = null;
    await boss.stop({ graceful: true, timeout: 10_000 });
  }

  private ready(): { boss: BossLike; module: PgBossModule } {
    if (!this.boss || !this.module) {
      throw new Error('La cola no esta iniciada');
    }
    return { boss: this.boss, module: this.module };
  }
}

function readDocumentId(job: BossJob): string {
  const value = job.data?.documentId;
  if (typeof value !== 'string' || value === '') {
    throw new Error('El trabajo no contiene un identificador de documento');
  }
  return value;
}
