import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export const DEFAULT_POOL_SIZE = 10;

export function createPool(connectionString: string, max: number = DEFAULT_POOL_SIZE): Pool {
  return new Pool({ connectionString, max });
}

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}
