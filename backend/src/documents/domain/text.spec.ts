import { HIGHLIGHT_END, HIGHLIGHT_START } from '@kata/shared';
import { PrefixChunkingStrategy } from './prefix-chunking';
import { countCodePoints, normalizeText, unitIndexAfterCodePoints } from './text';

describe('normalizeText (ADR-10)', () => {
  it('convierte los saltos de linea a LF', () => {
    expect(normalizeText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('elimina bytes nulos (E-11)', () => {
    expect(normalizeText('a\u0000b\u0000')).toBe('ab');
  });

  it('elimina la marca de orden de bytes inicial', () => {
    expect(normalizeText('\uFEFFhola')).toBe('hola');
  });

  it('elimina los delimitadores de resaltado reservados (E-27)', () => {
    expect(normalizeText(`a${HIGHLIGHT_START}b${HIGHLIGHT_END}c`)).toBe('abc');
  });

  it('normaliza a NFC', () => {
    expect(normalizeText('cafe\u0301')).toBe('caf\u00e9');
  });

  it('repara surrogados sueltos para que el texto sea UTF-8 valido', () => {
    expect(normalizeText('a\ud800b')).toBe('a\ufffdb');
  });
});

describe('conteo de caracteres Unicode', () => {
  it('cuenta un par sustituto como un solo caracter', () => {
    expect(countCodePoints('a\u{1F600}b')).toBe(3);
    expect('a\u{1F600}b'.length).toBe(4);
  });

  it('calcula la posicion UTF-16 tras N caracteres', () => {
    expect(unitIndexAfterCodePoints('a\u{1F600}bc', 2)).toBe(3);
    expect(unitIndexAfterCodePoints('abc', 10)).toBe(3);
    expect(unitIndexAfterCodePoints('abc', 0)).toBe(0);
  });
});

describe('PrefixChunkingStrategy (E-34, E-40)', () => {
  const strategy = new PrefixChunkingStrategy();

  it('indexa todo el texto si cabe', () => {
    expect(strategy.plan('hola mundo', 100)).toEqual({ totalChars: 10, indexedChars: 10 });
  });

  it('corta en el limite de un parrafo cercano', () => {
    const text = `${'a '.repeat(40)}\n\n${'b '.repeat(200)}`;
    const plan = strategy.plan(text, 120);
    expect(plan.totalChars).toBe(text.length);
    expect(text.slice(0, plan.indexedChars)).toBe('a '.repeat(40));
  });

  it('sin parrafo cercano corta en un limite de palabra', () => {
    const text = 'palabra '.repeat(100);
    const plan = strategy.plan(text, 21);
    const prefix = text.slice(0, plan.indexedChars);
    expect(prefix.length).toBeLessThanOrEqual(21);
    expect(prefix.endsWith('palabra')).toBe(true);
  });

  it('sin espacios corta exactamente en el tope', () => {
    expect(strategy.plan('x'.repeat(1000), 300)).toEqual({ totalChars: 1000, indexedChars: 300 });
  });

  it('no parte un par sustituto y mide en caracteres Unicode', () => {
    const text = '\u{1F600}'.repeat(50);
    const plan = strategy.plan(text, 10);
    expect(plan.totalChars).toBe(50);
    expect(plan.indexedChars).toBe(10);
  });

  it('el prefijo nunca supera el tope', () => {
    const text = 'lorem ipsum dolor sit amet\n\n'.repeat(500);
    for (const max of [10, 100, 999, 5000]) {
      expect(strategy.plan(text, max).indexedChars).toBeLessThanOrEqual(max);
    }
  });
});
