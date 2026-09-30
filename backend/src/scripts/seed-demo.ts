import { parseArgs } from 'node:util';
import { assertApiReady, DEFAULT_API_URL, DEFAULT_CACHE_DIR, loadDataset } from './load-dataset';

/**
 * Carga documentos de demostracion por la API (ADR-15). Reutiliza el cargador del benchmark.
 * Uso: npm run seed:demo -- --count 60
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      count: { type: 'string', default: '60' },
      api: { type: 'string', default: DEFAULT_API_URL },
      'cache-dir': { type: 'string', default: DEFAULT_CACHE_DIR },
    },
  });
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new Error('--count debe ser un entero entre 1 y 1000');
  }
  const apiUrl = String(values.api).replace(/\/+$/, '');

  await assertApiReady(apiUrl);
  const report = await loadDataset({
    apiUrl,
    count,
    profile: 'demo',
    cacheDir: String(values['cache-dir']),
    log: (message) => console.log(message),
  });

  console.log(
    `Listo: ${report.settled.indexed} indexados, ${report.settled.error} en ERROR, ${report.duplicates} ya existian, ${report.rejected} rechazados.`,
  );
  console.log('Consejo: haga una busqueda de calentamiento antes de la demostracion (la primera consulta con cache fria es la mas lenta).');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
