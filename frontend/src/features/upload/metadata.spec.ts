import { defaultTitle, hasSupportedExtension, parseTags, validateBatch } from './metadata';

const shared = { author: 'Ana Pérez', category: 'Manuales', tags: 'nestjs, servidor', version: '1.2' };

describe('hasSupportedExtension', () => {
  it.each([
    ['guia.txt', true],
    ['GUIA.TXT', true],
    ['notas.md', true],
    ['notas.markdown', true],
    ['manual.pdf', true],
    ['macro.exe', false],
    ['imagen.png', false],
    ['sin-extension', false],
    ['pdf', false],
    ['archivo.txt.exe', false],
  ])('%s -> %s', (name, expected) => {
    expect(hasSupportedExtension(name)).toBe(expected);
  });
});

describe('defaultTitle', () => {
  it('quita la extension y recorta espacios', () => {
    expect(defaultTitle('  Guia de instalacion .txt')).toBe('Guia de instalacion');
    expect(defaultTitle('a.b.md')).toBe('a.b');
  });

  it('conserva un nombre que empieza con punto y limita a 200 caracteres', () => {
    expect(defaultTitle('.hidden')).toBe('.hidden');
    expect(defaultTitle(`${'x'.repeat(300)}.txt`)).toHaveLength(200);
  });
});

describe('parseTags', () => {
  it('separa por comas, recorta y descarta vacios', () => {
    expect(parseTags(' uno, dos ,, tres ,')).toEqual(['uno', 'dos', 'tres']);
    expect(parseTags('')).toEqual([]);
  });
});

describe('validateBatch', () => {
  it('acepta metadatos validos por archivo y aplica los comunes', () => {
    const result = validateBatch(['Guia A', 'Guia B'], shared);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metadata).toHaveLength(2);
      expect(result.metadata[0]).toEqual({
        title: 'Guia A',
        author: 'Ana Pérez',
        category: 'Manuales',
        tags: ['nestjs', 'servidor'],
        version: '1.2',
      });
    }
  });

  it('permite version y etiquetas vacias', () => {
    const result = validateBatch(['Guia'], { ...shared, tags: '', version: '' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.metadata[0]).toMatchObject({ tags: [] });
  });

  it('reporta el titulo invalido por archivo (E-03)', () => {
    const result = validateBatch(['Guia', '   ', 'x'.repeat(201)], shared);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors.titles)).toEqual(['1', '2']);
      expect(result.errors.author).toBeUndefined();
    }
  });

  it('reporta los campos comunes invalidos una sola vez', () => {
    const result = validateBatch(['A', 'B'], { author: '', category: '', tags: 'a, A', version: 'v1' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.author).toBeDefined();
      expect(result.errors.category).toBeDefined();
      expect(result.errors.tags).toContain('repetirse');
      expect(result.errors.version).toContain('formato');
    }
  });

  it('rechaza mas de 10 etiquetas', () => {
    const tags = Array.from({ length: 11 }, (_, n) => `t${n}`).join(',');

    const result = validateBatch(['A'], { ...shared, tags });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.tags).toContain('10');
  });
});
