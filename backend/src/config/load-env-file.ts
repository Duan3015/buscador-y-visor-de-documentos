import fs from 'node:fs';
import path from 'node:path';

/** Carga backend/.env si existe. Las variables ya definidas en el entorno tienen prioridad. */
export function loadEnvFileIfPresent(directory: string = process.cwd()): void {
  const file = path.join(directory, '.env');
  if (fs.existsSync(file)) {
    process.loadEnvFile(file);
  }
}
