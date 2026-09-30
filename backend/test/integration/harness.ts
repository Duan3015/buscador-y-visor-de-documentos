import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DocumentStatusEvent } from '@kata/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client, Pool } from 'pg';
import { createApp } from '../../src/bootstrap';
import { loadConfig, type AppConfig } from '../../src/config/env';
import { dynamicImport } from '../../src/shared-kernel/dynamic-import';

export interface TestApp {
  app: NestExpressApplication;
  config: AppConfig;
  pool: Pool;
  server: ReturnType<NestExpressApplication['getHttpServer']>;
  baseUrl: string;
  /** Eventos publicados con pg_notify desde que se creo la aplicacion. */
  events: DocumentStatusEvent[];
  storedFiles(): string[];
  tempFiles(): string[];
  countJobs(queue?: string, state?: string): Promise<number>;
  /** Encola un trabajo directamente en pg-boss (para simular entregas). */
  sendJob(queue: string, data: object): Promise<void>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

interface BossHandle {
  send(name: string, data: object): Promise<string | null>;
  stop(): Promise<void>;
}

/** Espera activa hasta que la condicion se cumpla. Falla con el ultimo estado si se agota el plazo. */
export async function waitFor<T>(
  probe: () => Promise<T | null | undefined | false> | T | null | undefined | false,
  { timeoutMs = 20_000, intervalMs = 100 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Tiempo agotado tras ${timeoutMs} ms esperando una condicion`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Levanta la aplicacion real contra la base de datos de pruebas. */
export async function startTestApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const config: AppConfig = { ...loadConfig(process.env), appRole: 'api', ...overrides };
  const app = await createApp(config);
  await app.init();
  // Puerto efimero: algunas pruebas (SSE) necesitan una conexion HTTP real y persistente.
  await app.listen(0, '127.0.0.1');
  const baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  const pool = new Pool({ connectionString: config.databaseUrl, max: 2 });

  const events: DocumentStatusEvent[] = [];
  const listener = new Client({ connectionString: config.databaseUrl });
  await listener.connect();
  listener.on('notification', (message) => {
    if (message.payload) events.push(JSON.parse(message.payload) as DocumentStatusEvent);
  });
  await listener.query('LISTEN document_status');

  let boss: BossHandle | null = null;
  const ensureBoss = async (): Promise<BossHandle> => {
    if (boss) return boss;
    const module = await dynamicImport<{ PgBoss: new (options: object) => BossHandle & { start(): Promise<unknown> } }>('pg-boss');
    const instance = new module.PgBoss({ connectionString: config.databaseUrl, max: 2 });
    await instance.start();
    boss = instance;
    return instance;
  };

  const list = (dir: string): string[] => {
    try {
      return readdirSync(join(config.storageDir, dir));
    } catch {
      return [];
    }
  };

  return {
    app,
    config,
    pool,
    server: app.getHttpServer(),
    baseUrl,
    events,
    storedFiles: () => list('files'),
    tempFiles: () => list('.tmp'),
    async countJobs(queue = 'documents.index', state) {
      const result = state
        ? await pool.query<{ total: string }>('SELECT count(*) AS total FROM pgboss.job WHERE name = $1 AND state = $2', [queue, state])
        : await pool.query<{ total: string }>('SELECT count(*) AS total FROM pgboss.job WHERE name = $1', [queue]);
      return Number(result.rows[0]?.total ?? 0);
    },
    async sendJob(queue, data) {
      const handle = await ensureBoss();
      const id = await handle.send(queue, data);
      if (!id) throw new Error('No se pudo encolar el trabajo de prueba');
    },
    async reset() {
      await pool.query('DELETE FROM documents');
      await pool.query("DELETE FROM pgboss.job WHERE name LIKE 'documents.index%'");
      rmSync(join(config.storageDir, 'files'), { recursive: true, force: true });
      mkdirSync(join(config.storageDir, 'files'), { recursive: true });
      events.length = 0;
    },
    async close() {
      await listener.end();
      if (boss) await boss.stop();
      await pool.end();
      await app.close();
    },
  };
}
