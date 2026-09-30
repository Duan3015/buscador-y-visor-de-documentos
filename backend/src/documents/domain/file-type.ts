import { FORMAT_EXTENSIONS, type DocumentFormat } from '@kata/shared';
import { UnsupportedMediaTypeError } from '../../shared-kernel/errors';

/** Bytes iniciales que se conservan para validar el tipo real (ADR-10). */
export const HEAD_SAMPLE_BYTES = 1024;

const PDF_SIGNATURE = Buffer.from('%PDF-');

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index === -1 ? '' : filename.slice(index).toLowerCase();
}

function familyByExtension(extension: string): DocumentFormat | null {
  for (const [format, extensions] of Object.entries(FORMAT_EXTENSIONS) as [DocumentFormat, readonly string[]][]) {
    if (extensions.includes(extension)) return format;
  }
  return null;
}

function looksLikePdf(head: Buffer): boolean {
  return head.subarray(0, HEAD_SAMPLE_BYTES).includes(PDF_SIGNATURE);
}

/**
 * Determina el formato por los bytes, no por la extension ni el Content-Type (ADR-10, E-01).
 * - PDF: la firma %PDF- debe aparecer en los primeros 1024 bytes.
 * - TXT y Markdown: sin bytes nulos en la muestra inicial.
 * La extension debe ser coherente con la familia detectada.
 */
export function detectFormat(head: Buffer, originalFilename: string): DocumentFormat {
  const declared = familyByExtension(extensionOf(originalFilename));
  if (declared === null) {
    throw new UnsupportedMediaTypeError('La extension del archivo no es admitida. Use .txt, .md o .pdf');
  }

  const sample = head.subarray(0, HEAD_SAMPLE_BYTES);
  const isPdf = looksLikePdf(sample);

  if (declared === 'PDF') {
    if (!isPdf) {
      throw new UnsupportedMediaTypeError('El archivo tiene extension .pdf pero su contenido no es un PDF');
    }
    return 'PDF';
  }

  if (isPdf) {
    throw new UnsupportedMediaTypeError('El archivo parece un PDF pero su extension no lo es');
  }
  if (sample.includes(0)) {
    throw new UnsupportedMediaTypeError('El archivo contiene datos binarios y no es texto');
  }
  return declared;
}
