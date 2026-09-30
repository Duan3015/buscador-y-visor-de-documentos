import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnvFileIfPresent } from '../config/load-env-file';
import { maskDatabaseUrl } from '../config/env';
import { createDatabase, createPool } from './client';

export const MIGRATIONS_FOLDER = path.join(__dirname, 'migrations');

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl, 1);
  try {
    await migrate(createDatabase(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  loadEnvFileIfPresent();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL no esta definida. Copie backend/.env.example a backend/.env.');
    process.exitCode = 1;
    return;
  }
  console.log(`Aplicando migraciones en ${maskDatabaseUrl(databaseUrl)}`);
  await runMigrations(databaseUrl);
  console.log('Migraciones aplicadas.');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Fallo la migracion:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
