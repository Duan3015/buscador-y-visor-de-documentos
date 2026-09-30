import type { DocumentErrorCode } from '@kata/shared';
import type { Clock } from '../../shared-kernel/clock';
import type { DocumentRepository, EventPublisher, UnitOfWork } from '../domain/ports';
import { truncateDetail } from '../domain/processing-error';

export interface WorkLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const NOOP_WORK_LOGGER: WorkLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Transicion PROCESANDO a ERROR: estado, causa y evento en una sola transaccion, con la
 * comparacion de estado de ADR-08. Devuelve false si otro proceso ya habia resuelto el documento.
 */
export class DocumentFailureRecorder {
  constructor(
    private readonly repository: DocumentRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  async markAsFailed(
    documentId: string,
    code: DocumentErrorCode,
    detail: string,
    countAttempt = true,
  ): Promise<boolean> {
    const at = this.clock.now();
    return this.unitOfWork.run(async (ctx) => {
      const changed = await this.repository.markFailed(ctx, documentId, {
        code,
        detail: truncateDetail(detail),
        at,
        countAttempt,
      });
      if (changed) {
        await this.events.publishStatusChange(ctx, {
          documentId,
          status: 'ERROR',
          reason: code,
          occurredAt: at.toISOString(),
        });
      }
      return changed;
    });
  }
}
