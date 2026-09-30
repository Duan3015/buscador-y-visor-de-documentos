/** Percentil por el metodo del rango mas cercano sobre una muestra (no necesita estar ordenada). */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) throw new Error('No se puede calcular un percentil de una muestra vacia');
  if (p < 0 || p > 100) throw new Error('El percentil debe estar entre 0 y 100');
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}

export interface LatencySummary {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export function summarize(samples: readonly number[]): LatencySummary {
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    count: samples.length,
    min: Math.min(...samples),
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    max: Math.max(...samples),
    mean: total / samples.length,
  };
}
