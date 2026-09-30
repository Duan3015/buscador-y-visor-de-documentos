import type { Database } from '../../database/client';
import { ServiceUnavailableError } from '../../shared-kernel/errors';
import type { TransactionContext, UnitOfWork } from '../domain/ports';
import { isConnectionError } from './pg-errors';

export type DrizzleTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Contexto opaco para el dominio; solo los adaptadores de infraestructura acceden a la transaccion. */
export class DrizzleTransactionContext implements TransactionContext {
  readonly brand = 'TransactionContext' as const;
  constructor(readonly tx: DrizzleTransaction) {}
}

export function transactionOf(ctx: TransactionContext): DrizzleTransaction {
  if (!(ctx instanceof DrizzleTransactionContext)) {
    throw new Error('El contexto de transaccion no pertenece a este adaptador');
  }
  return ctx.tx;
}

export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly database: Database) {}

  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    try {
      return await this.database.transaction((tx) => work(new DrizzleTransactionContext(tx)));
    } catch (error) {
      if (isConnectionError(error)) throw new ServiceUnavailableError();
      throw error;
    }
  }
}
