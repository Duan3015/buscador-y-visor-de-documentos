import type { Pool } from 'pg';

/** Error de arranque: el proceso debe terminar con este mensaje y no arrancar a medias (E-49). */
export class StartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartupError';
  }
}

export async function assertDatabaseReady(pool: Pool): Promise<void> {
  try {
    await pool.query('SELECT 1');
  } catch {
    throw new StartupError(
      'No se pudo conectar a la base de datos. Verifique DATABASE_URL y que PostgreSQL este en marcha (npm run db:up).',
    );
  }

  const result = await pool.query<{ present: string | null }>(
    "SELECT to_regclass('public.documents') AS present",
  );
  if (!result.rows[0]?.present) {
    throw new StartupError('El esquema de la base de datos no existe. Ejecute: npm run db:migrate');
  }
}
