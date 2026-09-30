import { DynamicModule, Global, Inject, Injectable, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/env';
import { APP_CONFIG, DATABASE, DATABASE_POOL } from '../config/tokens';
import { createDatabase } from '../database/client';
import {
  EVENT_PUBLISHER,
  FILE_STORAGE,
  JOB_QUEUE,
  UNIT_OF_WORK,
  type JobQueuePort,
} from '../documents/domain/ports';
import { DiskFileStorage } from '../documents/infrastructure/disk-file-storage';
import { DrizzleUnitOfWork } from '../documents/infrastructure/drizzle-unit-of-work';
import { PgBossJobQueue } from '../documents/infrastructure/pg-boss-job-queue';
import { PgNotifyEventPublisher } from '../documents/infrastructure/pg-notify-event-publisher';
import { CLOCK, SystemClock } from '../shared-kernel/clock';
import { ID_GENERATOR, UuidGenerator } from '../shared-kernel/id-generator';

/** Conexiones reservadas para pg-boss; el resto del pool es para las consultas de la API. */
const QUEUE_POOL_SIZE = 4;

/** Arranca la cola al iniciar y libera cola y conexiones al cerrar (apagado ordenado). */
@Injectable()
class InfrastructureLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Infrastructure');

  constructor(
    @Inject(JOB_QUEUE) private readonly queue: JobQueuePort,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.start();
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.queue.stop();
    } catch (error) {
      this.logger.warn(`No se pudo detener la cola: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.pool.end();
  }
}

@Global()
@Module({})
export class InfrastructureModule {
  static forRoot(config: AppConfig, pool: Pool): DynamicModule {
    const logger = new Logger('JobQueue');
    return {
      module: InfrastructureModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: DATABASE_POOL, useValue: pool },
        { provide: DATABASE, useValue: createDatabase(pool) },
        { provide: CLOCK, useClass: SystemClock },
        { provide: ID_GENERATOR, useClass: UuidGenerator },
        { provide: FILE_STORAGE, useFactory: () => new DiskFileStorage(config.storageDir) },
        {
          provide: UNIT_OF_WORK,
          inject: [DATABASE],
          useFactory: (database: ReturnType<typeof createDatabase>) => new DrizzleUnitOfWork(database),
        },
        {
          provide: JOB_QUEUE,
          useFactory: () =>
            new PgBossJobQueue(
              {
                databaseUrl: config.databaseUrl,
                poolSize: QUEUE_POOL_SIZE,
                workerConcurrency: config.workerConcurrency,
                retryLimit: config.jobRetryLimit,
                retryDelaySeconds: config.jobRetryDelaySeconds,
                extractionTimeoutMs: config.extractionTimeoutMs,
              },
              { error: (message) => logger.error(message) },
            ),
        },
        { provide: EVENT_PUBLISHER, useClass: PgNotifyEventPublisher },
        InfrastructureLifecycle,
      ],
      exports: [
        APP_CONFIG,
        DATABASE_POOL,
        DATABASE,
        CLOCK,
        ID_GENERATOR,
        FILE_STORAGE,
        UNIT_OF_WORK,
        JOB_QUEUE,
        EVENT_PUBLISHER,
      ],
    };
  }
}
