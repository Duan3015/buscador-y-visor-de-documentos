import {
  Document,
  DocumentInvariantError,
  assertCanTransition,
  canTransition,
  sanitizeFilename,
} from './document';

const validInput = {
  id: 'doc-1',
  title: 'Guia',
  author: 'Ana',
  category: 'Manuales',
  tags: ['a', 'b'],
  version: null,
  format: 'TXT' as const,
  originalFilename: 'guia.txt',
  sizeBytes: 120,
  fileSha256: 'a'.repeat(64),
  createdAt: new Date('2026-09-29T12:00:00Z'),
};

describe('Document.create', () => {
  it('crea el documento en estado PROCESANDO', () => {
    const document = Document.create(validInput);
    expect(document.status).toBe('PROCESANDO');
    expect(document.id).toBe('doc-1');
    expect(document.props.originalFilename).toBe('guia.txt');
  });

  it('copia las etiquetas para que no se puedan alterar desde fuera', () => {
    const tags = ['x'];
    const document = Document.create({ ...validInput, tags });
    tags.push('y');
    expect(document.props.tags).toEqual(['x']);
  });

  it.each([
    ['huella con mayusculas', { fileSha256: 'A'.repeat(64) }],
    ['huella corta', { fileSha256: 'abc' }],
    ['tamano cero', { sizeBytes: 0 }],
    ['tamano decimal', { sizeBytes: 1.5 }],
    ['identificador vacio', { id: '  ' }],
  ])('rechaza %s', (_name, override) => {
    expect(() => Document.create({ ...validInput, ...override })).toThrow(DocumentInvariantError);
  });

  it('sanea el nombre original al crear (E-06)', () => {
    const document = Document.create({ ...validInput, originalFilename: '..\\..\\etc/passwd' });
    expect(document.props.originalFilename).toBe('passwd');
  });
});

describe('sanitizeFilename (E-06)', () => {
  it.each([
    ['../../secreto.txt', 'secreto.txt'],
    ['C:\\Users\\ana\\informe.pdf', 'informe.pdf'],
    ['   .oculto.md  ', 'oculto.md'],
    ['a<b>c:d|e?.txt', 'abcde.txt'],
    ['', 'sin-nombre'],
    ['///', 'sin-nombre'],
    ['nombre\u0000con\u0007control.txt', 'nombreconcontrol.txt'],
  ])('sanea %j como %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('limita la longitud a 255 caracteres', () => {
    expect(sanitizeFilename('x'.repeat(400) + '.txt')).toHaveLength(255);
  });
});

describe('transiciones de estado (E-14)', () => {
  it('permite PROCESANDO a INDEXADO y a ERROR', () => {
    expect(canTransition('PROCESANDO', 'INDEXADO')).toBe(true);
    expect(canTransition('PROCESANDO', 'ERROR')).toBe(true);
  });

  it.each([
    ['INDEXADO', 'ERROR'],
    ['INDEXADO', 'PROCESANDO'],
    ['ERROR', 'INDEXADO'],
    ['ERROR', 'PROCESANDO'],
    ['PROCESANDO', 'PROCESANDO'],
  ] as const)('rechaza %s a %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertCanTransition(from, to)).toThrow(DocumentInvariantError);
  });
});
