import {
  MAX_IDS_PER_REQUEST,
  MAX_SEARCH_PAGE,
  idsQuerySchema,
  searchQuerySchema,
  toFieldErrors,
  uploadMetadataSchema,
} from '../src';

const validMetadata = { title: 'Guia de instalacion', author: 'Ana', category: 'Manuales' };

describe('uploadMetadataSchema', () => {
  it('acepta metadatos minimos y aplica valores por defecto', () => {
    const result = uploadMetadataSchema.parse(validMetadata);
    expect(result.tags).toEqual([]);
    expect(result.version).toBeUndefined();
  });

  it('recorta espacios y acepta version y una sola etiqueta como texto', () => {
    const result = uploadMetadataSchema.parse({
      ...validMetadata,
      title: '  Guia  ',
      tags: 'nestjs',
      version: '1.2.3',
    });
    expect(result.title).toBe('Guia');
    expect(result.tags).toEqual(['nestjs']);
    expect(result.version).toBe('1.2.3');
  });

  it('acepta etiquetas repetidas en el campo (arreglo)', () => {
    const result = uploadMetadataSchema.parse({ ...validMetadata, tags: ['a', 'b'] });
    expect(result.tags).toEqual(['a', 'b']);
  });

  it('trata una version vacia como ausente', () => {
    expect(uploadMetadataSchema.parse({ ...validMetadata, version: '  ' }).version).toBeUndefined();
  });

  it.each([
    ['titulo vacio (E-03)', { ...validMetadata, title: '   ' }, 'title'],
    ['titulo demasiado largo', { ...validMetadata, title: 'x'.repeat(201) }, 'title'],
    ['autor ausente', { title: 'a', category: 'c' }, 'author'],
    ['categoria demasiado larga', { ...validMetadata, category: 'x'.repeat(51) }, 'category'],
    ['version con formato incorrecto (E-03)', { ...validMetadata, version: 'v1' }, 'version'],
    ['version con cuatro segmentos', { ...validMetadata, version: '1.2.3.4' }, 'version'],
  ])('rechaza %s', (_name, input, field) => {
    const result = uploadMetadataSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error).map((e) => e.field)).toContain(field);
    }
  });

  it('rechaza mas de 10 etiquetas (E-03)', () => {
    const tags = Array.from({ length: 11 }, (_v, i) => `t${i}`);
    expect(uploadMetadataSchema.safeParse({ ...validMetadata, tags }).success).toBe(false);
  });

  it('rechaza etiquetas repetidas ignorando mayusculas', () => {
    expect(uploadMetadataSchema.safeParse({ ...validMetadata, tags: ['API', 'api'] }).success).toBe(
      false,
    );
  });

  it('rechaza una etiqueta de mas de 30 caracteres', () => {
    expect(
      uploadMetadataSchema.safeParse({ ...validMetadata, tags: ['x'.repeat(31)] }).success,
    ).toBe(false);
  });

  it('rechaza campos desconocidos y los reporta por nombre (E-48)', () => {
    const result = uploadMetadataSchema.safeParse({ ...validMetadata, role: 'admin' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error)).toEqual([{ field: 'role', message: 'Campo no permitido' }]);
    }
  });
});

describe('searchQuerySchema', () => {
  it('usa la pagina 1 por defecto y recorta la consulta', () => {
    expect(searchQuerySchema.parse({ q: '  instalacion ' })).toEqual({ q: 'instalacion', page: 1 });
  });

  it('acepta la pagina como texto de la URL', () => {
    expect(searchQuerySchema.parse({ q: 'a', page: '3' }).page).toBe(3);
  });

  it.each([
    ['consulta vacia (E-16)', { q: '' }],
    ['consulta solo espacios (E-16)', { q: '   ' }],
    ['consulta ausente', {}],
    ['consulta de mas de 200 caracteres', { q: 'x'.repeat(201) }],
    ['pagina cero (E-19)', { q: 'a', page: '0' }],
    ['pagina negativa (E-19)', { q: 'a', page: '-1' }],
    ['pagina decimal (E-19)', { q: 'a', page: '1.5' }],
    ['pagina no numerica (E-19)', { q: 'a', page: 'abc' }],
    ['pagina vacia (E-19)', { q: 'a', page: '' }],
    [`pagina mayor a ${MAX_SEARCH_PAGE} (E-19)`, { q: 'a', page: String(MAX_SEARCH_PAGE + 1) }],
    ['pageSize ya no es parametro', { q: 'a', pageSize: '10' }],
    ['caracter nulo en la consulta', { q: 'abc\u0000def' }],
  ])('rechaza %s', (_name, input) => {
    expect(searchQuerySchema.safeParse(input).success).toBe(false);
  });

  it('acepta la pagina maxima', () => {
    expect(searchQuerySchema.parse({ q: 'a', page: String(MAX_SEARCH_PAGE) }).page).toBe(
      MAX_SEARCH_PAGE,
    );
  });

  it('acepta operadores y simbolos: la sintaxis la resuelve el motor (E-17)', () => {
    const q = '"frase exacta" OR -excluido & | :* (';
    expect(searchQuerySchema.parse({ q }).q).toBe(q);
  });
});

describe('idsQuerySchema', () => {
  const a = '3f2b8c1e-5d4a-4b7e-9c1a-1234567890ab';
  const b = '7a9d6e2f-1c3b-4d5e-8f60-abcdefabcdef';

  it('separa por comas y elimina duplicados', () => {
    expect(idsQuerySchema.parse({ ids: `${a}, ${b},${a}` }).ids).toEqual([a, b]);
  });

  it.each([
    ['vacio', ''],
    ['solo comas', ',,'],
    ['no es UUID', 'abc'],
  ])('rechaza ids %s', (_name, ids) => {
    expect(idsQuerySchema.safeParse({ ids }).success).toBe(false);
  });

  it('rechaza mas identificadores que el maximo', () => {
    const many = Array.from(
      { length: MAX_IDS_PER_REQUEST + 1 },
      (_v, i) => `3f2b8c1e-5d4a-4b7e-9c1a-${String(i).padStart(12, '0')}`,
    ).join(',');
    expect(idsQuerySchema.safeParse({ ids: many }).success).toBe(false);
  });
});
