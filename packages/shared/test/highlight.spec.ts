import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  PAGE_SIZE,
  offsetFor,
  parseHighlight,
  stripHighlightMarkers,
  totalPagesFor,
} from '../src';

const hit = (text: string) => `${HIGHLIGHT_START}${text}${HIGHLIGHT_END}`;

describe('parseHighlight', () => {
  it('devuelve un solo segmento sin coincidencia si no hay delimitadores', () => {
    expect(parseHighlight('texto plano')).toEqual([{ text: 'texto plano', match: false }]);
  });

  it('separa coincidencias y conserva las tildes', () => {
    expect(parseHighlight(`La ${hit('instalación')} del servicio`)).toEqual([
      { text: 'La ', match: false },
      { text: 'instalación', match: true },
      { text: ' del servicio', match: false },
    ]);
  });

  it('maneja coincidencias consecutivas y al inicio o al final', () => {
    expect(parseHighlight(`${hit('a')}${hit('b')} fin`)).toEqual([
      { text: 'a', match: true },
      { text: 'b', match: true },
      { text: ' fin', match: false },
    ]);
  });

  it('toma el resto como coincidencia si falta el delimitador de cierre', () => {
    expect(parseHighlight(`inicio ${HIGHLIGHT_START}sin cierre`)).toEqual([
      { text: 'inicio ', match: false },
      { text: 'sin cierre', match: true },
    ]);
  });

  it('no interpreta HTML: las etiquetas quedan como texto (E-42)', () => {
    expect(parseHighlight(`<script>alert(1)</script> ${hit('x')}`)).toEqual([
      { text: '<script>alert(1)</script> ', match: false },
      { text: 'x', match: true },
    ]);
  });

  it('devuelve una lista vacia para un texto vacio', () => {
    expect(parseHighlight('')).toEqual([]);
  });
});

describe('stripHighlightMarkers', () => {
  it('elimina ambos delimitadores', () => {
    expect(stripHighlightMarkers(`a${hit('b')}c`)).toBe('abc');
  });
});

describe('paginacion', () => {
  it('calcula el total de paginas con el tamano fijo', () => {
    expect(totalPagesFor(0)).toBe(0);
    expect(totalPagesFor(1)).toBe(1);
    expect(totalPagesFor(PAGE_SIZE)).toBe(1);
    expect(totalPagesFor(PAGE_SIZE + 1)).toBe(2);
    expect(totalPagesFor(-5)).toBe(0);
    expect(totalPagesFor(Number.NaN)).toBe(0);
  });

  it('calcula el desplazamiento', () => {
    expect(offsetFor(1)).toBe(0);
    expect(offsetFor(3)).toBe(2 * PAGE_SIZE);
  });
});
