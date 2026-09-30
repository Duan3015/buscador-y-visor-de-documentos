import type { DocumentStatusEvent } from '@kata/shared';
import { sql } from 'drizzle-orm';
import { STATUS_CHANNEL } from '../../shared-kernel/channels';
import type { EventPublisher, TransactionContext } from '../domain/ports';
import { transactionOf } from './drizzle-unit-of-work';

/**
 * Publica con pg_notify dentro de la transaccion del cambio de estado: PostgreSQL solo entrega
 * la notificacion si la transaccion confirma (ADR-07).
 */
export class PgNotifyEventPublisher implements EventPublisher {
  async publishStatusChange(ctx: TransactionContext, event: DocumentStatusEvent): Promise<void> {
    await transactionOf(ctx).execute(sql`select pg_notify(${STATUS_CHANNEL}, ${JSON.stringify(event)})`);
  }
}
