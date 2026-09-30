import type { ChunkingStrategy, IndexPlan } from './ports';
import { countCodePoints, unitIndexAfterCodePoints } from './text';

/** Cuanto se puede retroceder buscando un limite de parrafo o de palabra. */
const PARAGRAPH_WINDOW_RATIO = 0.1;
const MIN_PARAGRAPH_WINDOW = 1000;
const WORD_WINDOW = 200;

/**
 * Un solo fragmento con tope (ADR-03): indexa el prefijo del texto, cortado en un limite de
 * parrafo o, si no lo hay cerca, de palabra. Las medidas van en caracteres Unicode.
 */
export class PrefixChunkingStrategy implements ChunkingStrategy {
  plan(text: string, maxIndexableChars: number): IndexPlan {
    const totalChars = countCodePoints(text);
    if (totalChars <= maxIndexableChars) {
      return { totalChars, indexedChars: totalChars };
    }

    const limit = unitIndexAfterCodePoints(text, Math.max(maxIndexableChars, 0));
    const cut = this.boundaryBefore(text, limit);
    return { totalChars, indexedChars: countCodePoints(text.slice(0, cut)) };
  }

  private boundaryBefore(text: string, limit: number): number {
    const paragraphWindow = Math.max(MIN_PARAGRAPH_WINDOW, Math.floor(limit * PARAGRAPH_WINDOW_RATIO));
    const paragraph = text.lastIndexOf('\n\n', limit);
    if (paragraph > 0 && limit - paragraph <= paragraphWindow) return paragraph;

    for (let index = limit; index > 0 && limit - index <= WORD_WINDOW; index -= 1) {
      // El prefijo termina justo antes del espacio: el ultimo termino queda completo.
      if (/\s/.test(text.charAt(index))) return index;
    }
    return limit;
  }
}
