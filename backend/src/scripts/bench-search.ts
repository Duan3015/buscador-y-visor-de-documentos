import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BENCH_QUERIES, evaluate, measureQuery, type QueryMeasurement } from './bench-runner';
import { assertApiReady, DEFAULT_API_URL, DEFAULT_CACHE_DIR, loadDataset, type LoadReport } from './load-dataset';
import type { Profile } from './corpus';

const THRESHOLD_MS = 1000;
const CONCURRENCIES = [1, 5];

/**
 * Benchmark de la busqueda por la API real (ADR-13): carga el conjunto de datos con la propia
 * aplicacion y mide latencia por consulta con 1 y 5 clientes tras un calentamiento.
 * Uso: npm run bench:search -- --count 5000
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      count: { type: 'string', default: '5000' },
      profile: { type: 'string', default: 'mixed' },
      api: { type: 'string', default: DEFAULT_API_URL },
      samples: { type: 'string', default: '100' },
      warmup: { type: 'string', default: '10' },
      out: { type: 'string', default: '../docs/evidence/api-benchmark/results' },
      'cache-dir': { type: 'string', default: DEFAULT_CACHE_DIR },
      'skip-load': { type: 'boolean', default: false },
    },
  });

  const apiUrl = String(values.api).replace(/\/+$/, '');
  const count = Number(values.count);
  const samples = Number(values.samples);
  const warmup = Number(values.warmup);
  const profile = String(values.profile) as Profile;
  if (![count, samples].every((value) => Number.isInteger(value) && value > 0) || !Number.isInteger(warmup) || warmup < 0) {
    throw new Error('--count y --samples deben ser enteros positivos y --warmup un entero no negativo');
  }
  if (profile !== 'mixed' && profile !== 'demo') throw new Error('--profile debe ser mixed o demo');

  await assertApiReady(apiUrl);

  let load: LoadReport | null = null;
  if (!values['skip-load']) {
    console.log(`Cargando ${count} documentos por la API (${apiUrl})...`);
    load = await loadDataset({ apiUrl, count, profile, cacheDir: String(values['cache-dir']), log: (message) => console.log(message) });
    console.log(`Carga terminada: ${load.settled.indexed} indexados, ${load.settled.error} en ERROR, ${load.duplicates} ya existian.`);
  }

  const measurements: QueryMeasurement[] = [];
  for (const concurrency of CONCURRENCIES) {
    for (const query of BENCH_QUERIES) {
      const measurement = await measureQuery(query, { apiUrl, concurrency, samples, warmup });
      measurements.push(measurement);
      const { p50, p95, max } = measurement.summary;
      console.log(
        `[${concurrency} cliente(s)] ${query.label.padEnd(24)} total=${String(measurement.total).padStart(6)}  p50=${p50.toFixed(1)} ms  p95=${p95.toFixed(1)} ms  max=${max.toFixed(1)} ms`,
      );
    }
  }

  const verdict = evaluate(measurements, THRESHOLD_MS);
  const cpu = os.cpus();
  const report = {
    generatedAt: new Date().toISOString(),
    apiUrl,
    dataset: { count, profile, load },
    parameters: { samplesPerQuery: samples, warmupPerQuery: warmup, concurrencies: CONCURRENCIES },
    machine: {
      platform: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      cpuModel: cpu[0]?.model ?? 'desconocido',
      logicalCores: cpu.length,
      memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    },
    verdict,
    queries: measurements.map(({ samplesMs: _samples, ...rest }) => rest),
  };

  const out = resolve(String(values.out));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'resultados.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(
    join(out, 'muestras.jsonl'),
    measurements
      .map((m) => JSON.stringify({ label: m.label, q: m.q, page: m.page, concurrency: m.concurrency, samplesMs: m.samplesMs.map((ms) => Number(ms.toFixed(2))) }))
      .join('\n') + '\n',
    'utf8',
  );

  console.log(
    `\nVeredicto: ${verdict.passed ? 'CUMPLE' : 'NO CUMPLE'} (peor p95 = ${verdict.worstP95Ms.toFixed(1)} ms en "${verdict.worstLabel}" con ${verdict.worstConcurrency} cliente(s); umbral ${THRESHOLD_MS} ms)`,
  );
  console.log(`Resultados en ${out}`);
  if (!verdict.passed) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
