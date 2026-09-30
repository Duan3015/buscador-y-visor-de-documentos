import { percentile, summarize } from './stats';

describe('percentile', () => {
  it('calcula el rango mas cercano sin importar el orden', () => {
    const samples = [50, 10, 40, 20, 30];

    expect(percentile(samples, 50)).toBe(30);
    expect(percentile(samples, 95)).toBe(50);
    expect(percentile(samples, 20)).toBe(10);
    expect(percentile(samples, 0)).toBe(10);
    expect(percentile(samples, 100)).toBe(50);
  });

  it('con 100 muestras el p95 es la muestra 95', () => {
    const samples = Array.from({ length: 100 }, (_, n) => n + 1);

    expect(percentile(samples, 95)).toBe(95);
    expect(percentile(samples, 99)).toBe(99);
  });

  it('no modifica la muestra original', () => {
    const samples = [3, 1, 2];

    percentile(samples, 50);

    expect(samples).toEqual([3, 1, 2]);
  });

  it('rechaza una muestra vacia y percentiles fuera de rango', () => {
    expect(() => percentile([], 50)).toThrow('vacia');
    expect(() => percentile([1], -1)).toThrow('entre 0 y 100');
    expect(() => percentile([1], 101)).toThrow('entre 0 y 100');
  });
});

describe('summarize', () => {
  it('resume minimo, percentiles, maximo y media', () => {
    const summary = summarize([10, 20, 30, 40]);

    expect(summary).toEqual({ count: 4, min: 10, p50: 20, p95: 40, p99: 40, max: 40, mean: 25 });
  });
});
