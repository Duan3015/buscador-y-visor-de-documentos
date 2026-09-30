import { parseArgs } from 'node:util';
import { DOCUMENT_ERROR_CODES, type DocumentErrorCode } from '@kata/shared';
import { PurgeErrorDocuments } from '../documents/application/purge-error-documents';
import type { PurgeFilter } from '../documents/domain/ports';
import { DiskFileStorage } from '../documents/infrastructure/disk-file-storage';
import { DrizzleDocumentRepository } from '../documents/infrastructure/drizzle-document-repository';
import { loadConfig, maskDatabaseUrl } from '../config/env';
import { loadEnvFileIfPresent } from '../config/load-env-file';
import { createDatabase, createPool } from '../database/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Elimina los documentos en ERROR para poder volver a subir el mismo archivo (ADR-06, E-32).
 * Es un simulacro salvo que se pase --confirm.
 * Uso: npm run docs:purge-errors -- [--code PDF_CORRUPT] [--older-than-days 7] [--confirm]
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      confirm: { type: 'boolean', default: false },
      code: { type: 'string' },
      'older-than-days': { type: 'string' },
    },
  });

  const filter: PurgeFilter = {};
  if (values.code !== undefined) {
    if (!(DOCUMENT_ERROR_CODES as readonly string[]).includes(values.code)) {
      throw new Error(`--code invalido. Valores admitidos: ${DOCUMENT_ERROR_CODES.join(', ')}`);
    }
    filter.code = values.code as DocumentErrorCode;
  }
  if (values['older-than-days'] !== undefined) {
    const days = Number(values['older-than-days']);
    if (!Number.isFinite(days) || days < 0) throw new Error('--older-than-days debe ser un numero mayor o igual que 0');
    filter.olderThan = new Date(Date.now() - days * DAY_MS);
  }

  loadEnvFileIfPresent();
  const config = loadConfig(process.env);
  const pool = createPool(config.databaseUrl, 2);
  try {
    console.log(`Base de datos: ${maskDatabaseUrl(config.databaseUrl)}  Archivos: ${config.storageDir}`);
    const purge = new PurgeErrorDocuments(
      new DrizzleDocumentRepository(createDatabase(pool)),
      new DiskFileStorage(config.storageDir),
      {
        info: (message) => console.log(message),
        warn: (message) => console.warn(message),
        error: (message) => console.error(message),
      },
    );

    const report = await purge.execute({ filter, confirm: values.confirm === true });

    for (const candidate of report.candidates) {
      console.log(`  ${candidate.id}  ${candidate.code}  ${candidate.title}`);
    }
    if (!values.confirm) {
      console.log(`Simulacro: ${report.candidates.length} documentos en ERROR se eliminarian. Repita con --confirm para ejecutarlo.`);
      return;
    }
    console.log(
      `Eliminados: ${report.deleted}. Omitidos: ${report.skipped}. Con fallo: ${report.failed}. Archivos huerfanos: ${report.orphanFiles.length}.`,
    );
    if (report.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
