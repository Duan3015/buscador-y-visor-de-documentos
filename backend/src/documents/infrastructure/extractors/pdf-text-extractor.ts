import type { DocumentFormat } from '@kata/shared';
import { dynamicImport } from '../../../shared-kernel/dynamic-import';
import type { ExtractionLimits } from '../../domain/ports';
import { DocumentProcessingError, permanentFailure, transientFailure } from '../../domain/processing-error';
import { normalizeText } from '../../domain/text';
import type { FormatExtractor } from './format-extractor';

const PDFJS_MODULE = 'pdfjs-dist/legacy/build/pdf.mjs';

interface TextItem {
  str?: string;
  hasEOL?: boolean;
}

interface PdfPage {
  getTextContent(): Promise<{ items: TextItem[] }>;
  cleanup(): void;
}

interface PdfDocument {
  numPages: number;
  getPage(number: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface LoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}

interface PdfJs {
  getDocument(options: Record<string, unknown>): LoadingTask;
}

/** Nombres de error de pdf.js que indican un archivo ilegible: no tiene sentido reintentar. */
const CORRUPT_ERROR_NAMES = new Set([
  'InvalidPDFException',
  'FormatError',
  'XRefParseException',
  'MissingPDFException',
]);

/**
 * PDF con pdfjs-dist, pagina a pagina (ADR-10). Los limites de paginas, caracteres y tiempo se
 * aplican mientras se extrae. pdf.js no se puede interrumpir a mitad de una pagina: el plazo corta
 * la espera y la contencion real es el tope de paginas y caracteres.
 */
export class PdfTextExtractor implements FormatExtractor {
  readonly formats: readonly DocumentFormat[] = ['PDF'];

  async extract(data: Buffer, limits: ExtractionLimits): Promise<string> {
    const deadline = Date.now() + limits.timeoutMs;
    const pdfjs = await dynamicImport<PdfJs>(PDFJS_MODULE);

    const task = pdfjs.getDocument({
      // Copia: pdf.js toma posesion del buffer y lo desasocia.
      data: new Uint8Array(data),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      verbosity: 0,
    });

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(transientFailure('EXTRACTION_TIMEOUT', `La extraccion supero ${limits.timeoutMs} ms`)),
        limits.timeoutMs,
      );
    });

    try {
      const work = this.readAll(task, limits, deadline);
      // Si el plazo gana la carrera, la lectura sigue en segundo plano: su fallo no debe quedar sin atender.
      work.catch(() => undefined);
      const text = await Promise.race([work, timeout]);
      const normalized = normalizeText(text);
      if (normalized.trim() === '') {
        throw permanentFailure('NO_EXTRACTABLE_TEXT', 'El PDF no tiene capa de texto (posiblemente escaneado)');
      }
      return normalized;
    } finally {
      clearTimeout(timer);
      await task.destroy().catch(() => undefined);
    }
  }

  private async readAll(task: LoadingTask, limits: ExtractionLimits, deadline: number): Promise<string> {
    let pdf: PdfDocument;
    try {
      pdf = await task.promise;
    } catch (error) {
      throw this.classify(error);
    }

    if (pdf.numPages > limits.maxPages) {
      throw permanentFailure('PDF_TOO_MANY_PAGES', `El PDF tiene ${pdf.numPages} paginas; el maximo es ${limits.maxPages}`);
    }

    const pages: string[] = [];
    let totalChars = 0;
    try {
      for (let number = 1; number <= pdf.numPages; number += 1) {
        if (Date.now() > deadline) {
          throw transientFailure('EXTRACTION_TIMEOUT', `La extraccion supero ${limits.timeoutMs} ms`);
        }
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        page.cleanup();

        const pageText = content.items.map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ''}`).join('');
        totalChars += pageText.length;
        if (totalChars > limits.maxChars) {
          throw permanentFailure('TEXT_TOO_LARGE', `El texto supera el maximo de ${limits.maxChars} caracteres`);
        }
        pages.push(pageText);
      }
    } catch (error) {
      if (error instanceof DocumentProcessingError) throw error;
      throw this.classify(error);
    }
    return pages.join('\n\n');
  }

  private classify(error: unknown): Error {
    if (error instanceof DocumentProcessingError) return error;
    const name = error instanceof Error ? error.name : '';
    if (name === 'PasswordException') {
      return permanentFailure('PDF_ENCRYPTED', 'El PDF esta protegido con contrasena');
    }
    if (CORRUPT_ERROR_NAMES.has(name)) {
      return permanentFailure('PDF_CORRUPT', 'El PDF esta danado o no se puede leer');
    }
    return transientFailure('PROCESSING_FAILED', `Fallo inesperado al leer el PDF (${name || 'desconocido'})`, error);
  }
}
