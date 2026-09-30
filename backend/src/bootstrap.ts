import { LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfig } from './config/env';
import { createPool } from './database/client';
import { assertDatabaseReady } from './database/schema-check';
import { ProblemDetailsFilter } from './http/problem-details.filter';
import { traceIdMiddleware } from './http/trace-id';

const LOG_LEVELS: Record<AppConfig['logLevel'], LogLevel[]> = {
  error: ['error'],
  warn: ['error', 'warn'],
  info: ['error', 'warn', 'log'],
  debug: ['error', 'warn', 'log', 'debug'],
};

/**
 * Crea la aplicacion con todo su cableado. Verifica la base de datos antes de arrancar (E-49):
 * si no esta lista, falla con un mensaje claro en lugar de arrancar a medias.
 */
export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const pool = createPool(config.databaseUrl);
  try {
    await assertDatabaseReady(pool);
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, pool), {
    logger: LOG_LEVELS[config.logLevel],
  });

  app.use(traceIdMiddleware);
  app.use(helmet());
  app.use(
    compression({
      // El flujo SSE no se comprime: el bufer retrasaria los eventos (ADR-07).
      filter: (req, res) => !String(res.getHeader('Content-Type') ?? '').includes('text/event-stream') && compression.filter(req, res),
    }),
  );
  app.enableCors({ origin: config.corsOrigin, exposedHeaders: ['X-Request-Id', 'Location'] });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
  return app;
}
