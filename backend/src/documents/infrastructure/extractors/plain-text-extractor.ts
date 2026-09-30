import type { DocumentFormat } from '@kata/shared';
import type { ExtractionLimits } from '../../domain/ports';
import { permanentFailure } from '../../domain/processing-error';
import { normalizeText } from '../../domain/text';
import type { FormatExtractor } from './format-extractor';

/** TXT y Markdown: se decodifican como UTF-8 estricto y se indexan tal cual (ADR-10). */
export class PlainTextExtractor implements FormatExtractor {
  readonly formats: readonly DocumentFormat[] = ['TXT', 'MARKDOWN'];

  async extract(data: Buffer, limits: ExtractionLimits): Promise<string> {
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      throw permanentFailure('ENCODING_UNSUPPORTED', 'El archivo no es UTF-8 valido');
    }

    const text = normalizeText(decoded);
    if (text.length > limits.maxChars) {
      throw permanentFailure('TEXT_TOO_LARGE', `El texto supera el maximo de ${limits.maxChars} caracteres`);
    }
    if (text.trim() === '') {
      throw permanentFailure('NO_EXTRACTABLE_TEXT', 'El archivo no contiene texto');
    }
    return text;
  }
}
