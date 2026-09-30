import { Client } from 'pg';
import { runMigrations } from '../../src/database/migrate';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://docs:docs@localhost:5433/docs_test';

/** Crea la base de pruebas si no existe y aplica las migraciones (ADR-13). */
export default async function globalSetup(): Promise<void> {
  const target = new URL(TEST_DATABASE_URL);
  const databaseName = target.pathname.replace('/', '');
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = '/postgres';

  const client = new Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch {
    throw new Error(
      'PostgreSQL no esta disponible para las pruebas de integracion. Ejecute: npm run db:up',
    );
  }
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }

  await runMigrations(TEST_DATABASE_URL);
}
