import type { GeneratedDocument } from './corpus';

/** Subconjunto de fetch que usan los scripts (permite un doble en las pruebas). */
export type FetchLike = (
  input: string,
  init?: { method?: string; body?: FormData },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface UploadOutcome {
  filename: string;
  status: number;
  /** Identificador asignado (solo si la API acepto el documento). */
  id?: string;
  /** Codigo estable del error de la API (solo si la respuesta no fue 202). */
  code?: string;
}

export interface UploadOptions {
  apiUrl: string;
  concurrency?: number;
  fetchImpl?: FetchLike;
  onProgress?(done: number, total: number): void;
}

const RETRYABLE = new Set([0, 503]);
const MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toForm(doc: GeneratedDocument): FormData {
  const form = new FormData();
  form.append('title', doc.title);
  form.append('author', doc.author);
  form.append('category', doc.category);
  for (const tag of doc.tags) form.append('tags', tag);
  if (doc.version) form.append('version', doc.version);
  const type = doc.format === 'MARKDOWN' ? 'text/markdown' : 'text/plain';
  form.append('file', new Blob([doc.content], { type }), doc.filename);
  return form;
}

async function uploadOne(doc: GeneratedDocument, { apiUrl, fetchImpl = fetch as unknown as FetchLike }: UploadOptions): Promise<UploadOutcome> {
  for (let attempt = 1; ; attempt++) {
    let status = 0;
    let body: { id?: string; code?: string } = {};
    try {
      const response = await fetchImpl(`${apiUrl}/documents`, { method: 'POST', body: toForm(doc) });
      status = response.status;
      body = ((await response.json().catch(() => ({}))) ?? {}) as { id?: string; code?: string };
    } catch {
      status = 0;
    }
    if (status === 202) return { filename: doc.filename, status, id: body.id };
    // 503 (base ocupada) y fallos de red se reintentan con espera creciente; el resto es definitivo.
    if (RETRYABLE.has(status) && attempt < MAX_ATTEMPTS) {
      await sleep(250 * 2 ** attempt);
      continue;
    }
    return { filename: doc.filename, status, code: body.code ?? (status === 0 ? 'NETWORK_ERROR' : undefined) };
  }
}

/** Envia los documentos por la API real con concurrencia acotada y devuelve el resultado de cada uno. */
export async function uploadAll(docs: readonly GeneratedDocument[], options: UploadOptions): Promise<UploadOutcome[]> {
  const concurrency = Math.max(1, options.concurrency ?? 6);
  const outcomes: UploadOutcome[] = new Array(docs.length);
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= docs.length) return;
      outcomes[index] = await uploadOne(docs[index] as GeneratedDocument, options);
      done += 1;
      options.onProgress?.(done, docs.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, docs.length) }, worker));
  return outcomes;
}

export interface SettleOptions {
  apiUrl: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: FetchLike;
  onProgress?(counts: SettleCounts): void;
}

export interface SettleCounts {
  indexed: number;
  error: number;
  pending: number;
}

const IDS_PER_REQUEST = 50;

/** Consulta los estados por lotes hasta que ningun documento siga en PROCESANDO o se agote el plazo. */
export async function waitUntilSettled(ids: readonly string[], options: SettleOptions): Promise<SettleCounts> {
  const { apiUrl, timeoutMs = 30 * 60_000, intervalMs = 2_000, fetchImpl = fetch as unknown as FetchLike } = options;
  const finished = new Map<string, 'INDEXADO' | 'ERROR'>();
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const pending = ids.filter((id) => !finished.has(id));
    for (let offset = 0; offset < pending.length; offset += IDS_PER_REQUEST) {
      const batch = pending.slice(offset, offset + IDS_PER_REQUEST);
      const response = await fetchImpl(`${apiUrl}/documents?ids=${batch.join(',')}`);
      if (!response.ok) throw new Error(`La consulta de estados respondio HTTP ${response.status}`);
      const { items } = (await response.json()) as { items: Array<{ id: string; status: string }> };
      for (const item of items) {
        if (item.status === 'INDEXADO' || item.status === 'ERROR') finished.set(item.id, item.status);
      }
    }

    const counts: SettleCounts = { indexed: 0, error: 0, pending: 0 };
    for (const id of ids) {
      const status = finished.get(id);
      if (status === 'INDEXADO') counts.indexed += 1;
      else if (status === 'ERROR') counts.error += 1;
      else counts.pending += 1;
    }
    options.onProgress?.(counts);
    if (counts.pending === 0) return counts;
    if (Date.now() > deadline) throw new Error(`Tiempo agotado: ${counts.pending} documentos siguen en PROCESANDO`);
    await sleep(intervalMs);
  }
}
