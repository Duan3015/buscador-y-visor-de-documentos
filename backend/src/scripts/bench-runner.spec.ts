import { BENCH_QUERIES, evaluate, measureQuery, type QueryMeasurement } from './bench-runner';
import type { FetchLike } from './loader';
import { summarize } from './stats';

function fakeClock() {
  let time = 0;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

describe('measureQuery', () => {
  it('descarta el calentamiento, mide las muestras pedidas y arma la URL con la pagina', async () => {
    const clock = fakeClock();
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url);
      clock.advance(urls.length <= 3 ? 500 : 10);
      return { ok: true, status: 200, json: () => Promise.resolve({ total: 42 }) };
    };

    const result = await measureQuery(
      { label: 'x', q: '"don quijote"', page: 20 },
      { apiUrl: 'http://api/api', concurrency: 1, samples: 5, warmup: 3, fetchImpl, now: clock.now },
    );

    expect(urls).toHaveLength(8);
    expect(urls[0]).toBe('http://api/api/search?q=%22don+quijote%22&page=20');
    expect(result.samplesMs).toEqual([10, 10, 10, 10, 10]);
    expect(result).toMatchObject({ page: 20, total: 42, concurrency: 1 });
    expect(result.summary.p95).toBe(10);
  });

  it('reparte las muestras entre los clientes concurrentes sin exceder el total', async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl: FetchLike = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { ok: true, status: 200, json: () => Promise.resolve({ total: 1 }) };
    };

    const result = await measureQuery({ label: 'x', q: 'a' }, { apiUrl: 'http://api/api', concurrency: 5, samples: 23, warmup: 0, fetchImpl });

    expect(result.samplesMs).toHaveLength(23);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it('falla si la API responde con error para no medir respuestas de fallo', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });

    await expect(
      measureQuery({ label: 'x', q: 'a' }, { apiUrl: 'http://api/api', concurrency: 1, samples: 1, warmup: 0, fetchImpl }),
    ).rejects.toThrow('HTTP 500');
  });
});

describe('evaluate', () => {
  const measurement = (label: string, concurrency: number, samples: number[]): QueryMeasurement => ({
    label,
    q: label,
    page: 1,
    concurrency,
    total: 1,
    samplesMs: samples,
    summary: summarize(samples),
  });

  it('aprueba cuando el peor p95 no supera el umbral y lo identifica', () => {
    const verdict = evaluate([measurement('a', 1, [10, 20]), measurement('b', 5, [300, 900])], 1000);

    expect(verdict).toEqual({ thresholdMs: 1000, passed: true, worstP95Ms: 900, worstLabel: 'b', worstConcurrency: 5 });
  });

  it('reprueba cuando alguna consulta supera el umbral', () => {
    const verdict = evaluate([measurement('a', 1, [10, 1500])], 1000);

    expect(verdict.passed).toBe(false);
  });

  it('rechaza una lista vacia', () => {
    expect(() => evaluate([], 1000)).toThrow('No hay mediciones');
  });
});

describe('BENCH_QUERIES', () => {
  it('cubre los tipos de consulta de la ADR-13', () => {
    const labels = BENCH_QUERIES.map((query) => query.label);

    expect(labels).toEqual(
      expect.arrayContaining(['palabra frecuente', 'palabra rara', 'frase entre comillas', 'con tilde', 'sin resultados']),
    );
  });
});
