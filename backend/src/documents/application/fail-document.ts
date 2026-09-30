import type { Clock } from '../../shared-kernel/clock';
import type { DeadLetterInfo, DocumentRepository, EventPublisher, UnitOfWork } from '../domain/ports';
import { DocumentFailureRecorder, NOOP_WORK_LOGGER, type WorkLogger } from './document-failure';

/**
 * Consumidor de la cola de mensajes fallidos (ADR-08): cuando la cola agota los reintentos o el
 * trabajo caduca porque el worker cayo, promueve el documento a ERROR con la causa ya registrada
 * o, si no hay ninguna, con WORKER_LOST. Usa la misma transicion condicionada (idempotente).
 */
export class FailDocument {
  private readonly failures: DocumentFailureRecorder;

  constructor(
    private readonly repository: DocumentRepository,
    unitOfWork: UnitOfWork,
    events: EventPublisher,
    clock: Clock,
    private readonly logger: WorkLogger = NOOP_WORK_LOGGER,
  ) {
    this.failures = new DocumentFailureRecorder(repository, unitOfWork, events, clock);
  }

  async execute(job: DeadLetterInfo): Promise<void> {
    const recorded = await this.repository.findLastErrorCode(job.documentId);
    const code = recorded ?? 'WORKER_LOST';
    const detail =
      recorded === null
        ? 'El trabajo caduco sin que el worker registrara una causa'
        : `Reintentos agotados tras ${job.retryCount ?? 0} reintentos`;

    // Con una causa registrada, cada intento fallido ya se conto; sin ella, este es el unico fallo.
    const changed = await this.failures.markAsFailed(job.documentId, code, detail, recorded === null);
    this.logger.warn(
      changed
        ? `documentId=${job.documentId} promovido a ERROR desde la cola de mensajes fallidos (${code})`
        : `documentId=${job.documentId} ya estaba resuelto; se descarta el mensaje fallido`,
    );
  }
}
