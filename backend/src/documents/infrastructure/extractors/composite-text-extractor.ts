import type { DocumentFormat } from '@kata/shared';
import type { ExtractionLimits, TextExtractorPort } from '../../domain/ports';
import type { FormatExtractor } from './format-extractor';

/** Despacha a la estrategia registrada para el formato. Agregar un formato no modifica este codigo. */
export class CompositeTextExtractor implements TextExtractorPort {
  private readonly byFormat = new Map<DocumentFormat, FormatExtractor>();

  constructor(extractors: readonly FormatExtractor[]) {
    for (const extractor of extractors) {
      for (const format of extractor.formats) this.byFormat.set(format, extractor);
    }
  }

  extract(format: DocumentFormat, data: Buffer, limits: ExtractionLimits): Promise<string> {
    const extractor = this.byFormat.get(format);
    if (!extractor) {
      return Promise.reject(new Error(`No hay extractor para el formato ${format}`));
    }
    return extractor.extract(data, limits);
  }
}
