import { performance } from 'node:perf_hooks';
import type { FetchLike } from './loader';
import { summarize, type LatencySummary } from './stats';

export interface BenchQuery {
  label: string;
  q: string;
  page?: number;
}

/** Consultas del benchmark (ADR-13): frecuente, rara, frase, con tilde, varias palabras, sin resultados y pagina profunda. */
export const BENCH_QUERIES: readonly BenchQuery[] = [
  { label: 'palabra frecuente', q: 'caballero' },
  { label: 'palabra rara', q: 'aldonza' },
  { label: 'frase entre comillas', q: '"don quijote"' },
  { label: 'con tilde', q: 'ínsula' },
  { label: 'varias palabras', q: 'amor tiempo caballero' },
  { label: 'sin resultados', q: 'xyzzyplugh' },
  { label: 'pagina profunda (20)', q: 'caballero', page: 20 },
];

export interface QueryMeasurement {
  label: string;
  q: string;
  page: number;
  concurrency: number;
  /** Total de coincidencias que informa la API (para verificar que la consulta trabaja de verdad). */
  total: number;
  samplesMs: number[];
  summary: LatencySummary;
}

export interface MeasureOptions {
  apiUrl: string;
  concurrency: number;
  samples: number;
  warmup: number;
  fetchImpl?: FetchLike;
  now?: () => number;
}

async function timedRequest(url: string, fetchImpl: FetchLike, now: () => number): Promise<{ ms: number; total: number }> {
  const start = now();
  const response = await fetchImpl(url);
  const body = (await response.json()) as { total?: number };
  const ms = now() - start;
  if (!response.ok) throw new Error(`La busqueda respondio HTTP ${response.status} para ${url}`);
  return { ms, total: body.total ?? 0 };
}

/** Mide una consulta: calentamiento secuencial y luego `samples` solicitudes repartidas entre los clientes. */
export async function measureQuery(query: BenchQuery, options: MeasureOptions): Promise<QueryMeasurement> {
  const { apiUrl, concurrency, samples, warmup, fetchImpl = fetch as unknown as FetchLike, now = () => performance.now() } = options;
  const page = query.page ?? 1;
  const url = `${apiUrl}/search?${new URLSearchParams({ q: query.q, page: String(page) }).toString()}`;

  let total = 0;
  for (let index = 0; index < warmup; index++) total = (await timedRequest(url, fetchImpl, now)).total;

  const samplesMs: number[] = [];
  let issued = 0;
  const client = async (): Promise<void> => {
    while (issued < samples) {
      issued += 1;
      const result = await timedRequest(url, fetchImpl, now);
      total = result.total;
      samplesMs.push(result.ms);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, client));

  return { label: query.label, q: query.q, page, concurrency, total, samplesMs, summary: summarize(samplesMs) };
}

export interface Verdict {
  thresholdMs: number;
  passed: boolean;
  worstP95Ms: number;
  worstLabel: string;
  worstConcurrency: number;
}

/** Criterio de aceptacion: el p95 de cada consulta y concurrencia no supera el umbral. */
export function evaluate(measurements: readonly QueryMeasurement[], thresholdMs: number): Verdict {
  if (measurements.length === 0) throw new Error('No hay mediciones que evaluar');
  const worst = measurements.reduce((max, current) => (current.summary.p95 > max.summary.p95 ? current : max));
  return {
    thresholdMs,
    passed: worst.summary.p95 <= thresholdMs,
    worstP95Ms: worst.summary.p95,
    worstLabel: worst.label,
    worstConcurrency: worst.concurrency,
  };
}
