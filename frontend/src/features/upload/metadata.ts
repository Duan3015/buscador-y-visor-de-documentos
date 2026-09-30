import { FORMAT_EXTENSIONS, METADATA_LIMITS, uploadMetadataSchema, type UploadMetadata } from '@kata/shared';

const SUPPORTED_EXTENSIONS: readonly string[] = Object.values(FORMAT_EXTENSIONS).flat();

/** Valor del atributo `accept` del selector de archivos. */
export const ACCEPT_ATTRIBUTE = SUPPORTED_EXTENSIONS.join(',');

export function hasSupportedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** Propone un titulo a partir del nombre del archivo (sin extension), acotado al maximo permitido. */
export function defaultTitle(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return base.trim().slice(0, METADATA_LIMITS.title.max);
}

/** Convierte "a, b ,, c" en ["a", "b", "c"]. */
export function parseTags(text: string): string[] {
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

export interface SharedFields {
  author: string;
  category: string;
  tags: string;
  version: string;
}

export interface MetadataErrors {
  author?: string;
  category?: string;
  tags?: string;
  version?: string;
  /** Errores del titulo por indice de archivo. */
  titles: Record<number, string>;
}

export type ValidationResult =
  | { ok: true; metadata: UploadMetadata[] }
  | { ok: false; errors: MetadataErrors };

/**
 * Valida con el esquema compartido los metadatos de cada archivo (titulo propio y campos
 * comunes). La regla es la misma que aplica el servidor, por lo que no pueden divergir.
 */
export function validateBatch(titles: string[], shared: SharedFields): ValidationResult {
  const errors: MetadataErrors = { titles: {} };
  const metadata: UploadMetadata[] = [];

  titles.forEach((title, index) => {
    const parsed = uploadMetadataSchema.safeParse({
      title,
      author: shared.author,
      category: shared.category,
      tags: parseTags(shared.tags),
      version: shared.version,
    });
    if (parsed.success) {
      metadata.push(parsed.data);
      return;
    }
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field === 'title') {
        errors.titles[index] ??= issue.message;
      } else if (field === 'author' || field === 'category' || field === 'version') {
        errors[field] ??= issue.message;
      } else if (field === 'tags') {
        errors.tags ??= issue.message;
      }
    }
  });

  const hasErrors =
    Object.keys(errors.titles).length > 0 || Boolean(errors.author ?? errors.category ?? errors.tags ?? errors.version);
  return hasErrors ? { ok: false, errors } : { ok: true, metadata };
}
