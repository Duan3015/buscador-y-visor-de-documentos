import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileStorage } from '../domain/ports';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Almacenamiento en disco (ADR-05). El archivo definitivo se nombra solo con el identificador
 * generado por el servidor; el nombre original nunca forma parte de la ruta (E-06).
 * El temporal vive en el mismo volumen para que el renombrado sea atomico (E-43).
 */
export class DiskFileStorage implements FileStorage {
  private readonly tempDir: string;
  private readonly filesDir: string;

  constructor(rootDir: string) {
    this.tempDir = join(rootDir, '.tmp');
    this.filesDir = join(rootDir, 'files');
    mkdirSync(this.tempDir, { recursive: true });
    mkdirSync(this.filesDir, { recursive: true });
  }

  createTempPath(): string {
    return join(this.tempDir, `${randomUUID()}.part`);
  }

  async commitTemp(tempPath: string, documentId: string): Promise<void> {
    await rename(tempPath, this.pathFor(documentId));
  }

  async discardTemp(tempPath: string): Promise<void> {
    await ignoreMissing(() => unlink(tempPath));
  }

  async remove(documentId: string): Promise<void> {
    await ignoreMissing(() => unlink(this.pathFor(documentId)));
  }

  async read(documentId: string): Promise<Buffer> {
    return readFile(this.pathFor(documentId));
  }

  private pathFor(documentId: string): string {
    if (!UUID_PATTERN.test(documentId)) {
      throw new Error('Identificador de documento invalido para el almacenamiento');
    }
    return join(this.filesDir, documentId);
  }
}

async function ignoreMissing(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
