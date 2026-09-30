'use strict';

/**
 * Ejecuta cada archivo de pruebas de integracion en un proceso de Node independiente.
 *
 * Los modulos ES (pg-boss, pdfjs-dist) se cargan con import dinamico. Bajo
 * --experimental-vm-modules, un proceso de Jest que ejecuta varios archivos en serie deja el
 * import dinamico ligado al entorno del primer archivo y falla en los siguientes. Aislar por
 * proceso evita ese acoplamiento sin tocar el codigo de produccion.
 *
 * Uso: node scripts/run-integration.js [filtro ...]   (el filtro es un fragmento del nombre)
 */
const { readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '..');
const dir = join(root, 'test', 'integration');
const filters = process.argv.slice(2);

const files = readdirSync(dir)
  .filter((name) => name.endsWith('.spec.ts'))
  .filter((name) => filters.length === 0 || filters.some((filter) => name.includes(filter)))
  .sort();

if (files.length === 0) {
  console.error('No hay archivos de integracion que coincidan con el filtro.');
  process.exit(1);
}

// El paquete no exporta bin/jest.js: se resuelve desde package.json y se compone la ruta.
const jestPackage = require.resolve('jest/package.json', { paths: [root] });
const jest = join(jestPackage, '..', 'bin', 'jest.js');
const failed = [];

for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const result = spawnSync(
    process.execPath,
    ['--experimental-vm-modules', jest, '--selectProjects', 'integration', '--runInBand', `test/integration/${file}`],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.status !== 0) failed.push(file);
}

if (failed.length > 0) {
  console.error(`\nArchivos con fallos: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`\nIntegracion: ${files.length} archivos correctos`);
