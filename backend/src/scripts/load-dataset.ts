import { buildDocuments, loadCorpus, type FetchText, type Profile } from './corpus';
import { uploadAll, waitUntilSettled, type FetchLike, type SettleCounts, type UploadOutcome } from './loader';

export const DEFAULT_API_URL = 'http://localhost:3001/api';
export const DEFAULT_CACHE_DIR = '.cache/corpus';

/** Descarga de texto con fetch nativo. */
export const httpFetchText: FetchText = (url) => fetch(url);

/** Confirma que la API responde antes de empezar un proceso largo. */
export async function assertApiReady(apiUrl: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<void> {
  try {
    const response = await fetchImpl(`${apiUrl}/search?q=prueba`);
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `La API no responde en ${apiUrl} (${reason}). Inicie la aplicacion con APP_ROLE=all (npm run dev:api) y la base de datos (npm run db:up).`,
    );
  }
}

export interface LoadOptions {
  apiUrl: string;
  count: number;
  profile: Profile;
  cacheDir: string;
  concurrency?: number;
  log?(message: string): void;
}

export interface LoadReport {
  requested: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  settled: SettleCounts;
  uploadMs: number;
  indexMs: number;
}

/**
 * Carga el conjunto de datos por la API real (la propia aplicacion lo indexa) y espera a que
 * termine el procesamiento asincrono. Es reanudable: un documento ya cargado responde 409 y se omite.
 */
export async function loadDataset(options: LoadOptions): Promise<LoadReport> {
  const log = options.log ?? (() => undefined);
  const books = await loadCorpus(options.cacheDir, httpFetchText, log);
  const docs = buildDocuments(books, { count: options.count, profile: options.profile });
  log(`Generados ${docs.length} documentos (perfil ${options.profile}).`);

  const uploadStart = Date.now();
  const outcomes: UploadOutcome[] = await uploadAll(docs, {
    apiUrl: options.apiUrl,
    concurrency: options.concurrency,
    onProgress: (done, total) => {
      if (done % 250 === 0 || done === total) log(`Enviados ${done}/${total}`);
    },
  });
  const uploadMs = Date.now() - uploadStart;

  const ids = outcomes.flatMap((outcome) => (outcome.id ? [outcome.id] : []));
  const duplicates = outcomes.filter((outcome) => outcome.status === 409).length;
  const rejected = outcomes.length - ids.length - duplicates;
  if (rejected > 0) {
    const sample = outcomes.filter((outcome) => outcome.status !== 202 && outcome.status !== 409).slice(0, 3);
    log(`Rechazados: ${rejected}. Ejemplos: ${JSON.stringify(sample)}`);
  }

  const indexStart = Date.now();
  let lastLogged = 0;
  const settled = await waitUntilSettled(ids, {
    apiUrl: options.apiUrl,
    onProgress: (counts) => {
      const finished = counts.indexed + counts.error;
      if (finished - lastLogged >= 250 || counts.pending === 0) {
        lastLogged = finished;
        log(`Procesados ${finished}/${ids.length} (ERROR: ${counts.error})`);
      }
    },
  });
  const indexMs = Date.now() - indexStart;

  return { requested: docs.length, accepted: ids.length, duplicates, rejected, settled, uploadMs, indexMs };
}
