import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { AppConfig } from '../../config/env';
import { APP_CONFIG } from '../../config/tokens';
import { FailDocument } from '../application/fail-document';
import { ProcessDocument } from '../application/process-document';
import { JOB_QUEUE, type JobQueuePort } from '../domain/ports';

/**
 * Adaptador de entrada del rol worker: conecta los consumidores de la cola con los casos de uso.
 * En el rol `api` no registra nada, de modo que solo encola.
 */
@Injectable()
export class IndexingWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('IndexingWorker');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(JOB_QUEUE) private readonly queue: JobQueuePort,
    @Inject(ProcessDocument) private readonly processDocument: ProcessDocument,
    @Inject(FailDocument) private readonly failDocument: FailDocument,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.appRole === 'api') {
      this.logger.log('Rol api: los consumidores de la cola no se registran');
      return;
    }
    await this.queue.consume({
      onIndex: (job) => this.processDocument.execute(job.documentId),
      onDeadLetter: (job) => this.failDocument.execute(job),
    });
    this.logger.log(`Consumidores registrados (concurrencia ${this.config.workerConcurrency})`);
  }
}
