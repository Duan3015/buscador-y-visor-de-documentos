import { HIGHLIGHT_END, HIGHLIGHT_START } from '@kata/shared';

const NULL_CHAR = /\u0000/g;
const LINE_BREAKS = /\r\n?/g;
const RESERVED_MARKERS = new RegExp(`[${HIGHLIGHT_START}${HIGHLIGHT_END}]`, 'g');

/**
 * Normalizacion comun del texto extraido (ADR-10): saltos de linea a LF, sin bytes nulos
 * (PostgreSQL los rechaza), sin marca de orden de bytes, sin los delimitadores de resaltado
 * reservados (ADR-11), con surrogados sueltos reparados y en forma NFC.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(LINE_BREAKS, '\n')
    .replace(NULL_CHAR, '')
    .replace(RESERVED_MARKERS, '')
    .toWellFormed()
    .normalize('NFC');
}

/** Cuenta caracteres Unicode (puntos de codigo), la unidad que usa `left()` de PostgreSQL. */
export function countCodePoints(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
}

/** Posicion UTF-16 en la que terminan los primeros `codePoints` caracteres Unicode. */
export function unitIndexAfterCodePoints(text: string, codePoints: number): number {
  let index = 0;
  let count = 0;
  while (index < text.length && count < codePoints) {
    const code = text.charCodeAt(index);
    const isPair =
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff;
    index += isPair ? 2 : 1;
    count += 1;
  }
  return index;
}
