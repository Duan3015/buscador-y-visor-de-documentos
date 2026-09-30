import { HIGHLIGHT_END, HIGHLIGHT_START } from './constants';

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Convierte un fragmento con delimitadores de resaltado en segmentos de texto.
 * El resultado nunca contiene HTML: el frontend lo pinta como nodos de texto.
 * Tolera delimitadores sin cerrar: el resto del fragmento se toma como coincidencia.
 */
export function parseHighlight(fragment: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let inMatch = false;

  const push = (text: string, match: boolean) => {
    if (text !== '') segments.push({ text, match });
  };

  while (cursor < fragment.length) {
    const marker = inMatch ? HIGHLIGHT_END : HIGHLIGHT_START;
    const next = fragment.indexOf(marker, cursor);
    if (next === -1) {
      push(fragment.slice(cursor), inMatch);
      break;
    }
    push(fragment.slice(cursor, next), inMatch);
    cursor = next + 1;
    inMatch = !inMatch;
  }
  return segments;
}

/** Elimina los delimitadores de resaltado de un texto. */
export function stripHighlightMarkers(text: string): string {
  return text.split(HIGHLIGHT_START).join('').split(HIGHLIGHT_END).join('');
}
