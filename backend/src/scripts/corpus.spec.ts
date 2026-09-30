import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GUTENBERG_BOOKS, buildDocuments, createRandom, loadCorpus, stripGutenberg, type FetchText } from './corpus';

const WORDS = ['caballero', 'batalla', 'ventura', 'camino', 'palabra', 'historia', 'ciudad', 'noche', 'razon', 'amor', 'tiempo', 'mundo'];

/** Libro sintetico determinista con parrafos, para probar sin descargar nada. */
function fakeBook(seed: number, chars: number): string {
  const random = createRandom(seed);
  let text = '';
  while (text.length < chars) {
    const paragraph = Array.from({ length: 40 }, () => WORDS[Math.floor(random() * WORDS.length)]).join(' ');
    text += `${paragraph} ${Math.floor(random() * 1e9)}.\n\n`;
  }
  return text;
}

const books = Array.from({ length: 6 }, (_, n) => fakeBook(n + 1, 400_000));

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('stripGutenberg', () => {
  it('conserva solo el texto entre las marcas y normaliza los saltos de linea', () => {
    const raw = '\uFEFFencabezado legal\r\n*** START OF THE PROJECT GUTENBERG EBOOK EL QUIJOTE ***\r\n\r\nTexto real\r\ncontinua\r\n*** END OF THE PROJECT GUTENBERG EBOOK EL QUIJOTE ***\r\nlicencia';

    expect(stripGutenberg(raw)).toBe('Texto real\ncontinua');
  });

  it('sin marcas devuelve el texto completo recortado', () => {
    expect(stripGutenberg('  solo texto \n')).toBe('solo texto');
  });
});

describe('createRandom', () => {
  it('es determinista por semilla y produce valores en [0, 1)', () => {
    const a = createRandom(7);
    const b = createRandom(7);
    const values = Array.from({ length: 50 }, () => a());

    expect(values).toEqual(Array.from({ length: 50 }, () => b()));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(createRandom(8)()).not.toBe(createRandom(7)());
  });
});

describe('buildDocuments', () => {
  it('es reproducible con la misma semilla', () => {
    const first = buildDocuments(books, { count: 30 });
    const second = buildDocuments(books, { count: 30 });

    expect(second).toEqual(first);
    expect(buildDocuments(books, { count: 30, seed: 1 })).not.toEqual(first);
  });

  it('genera contenido unico para no chocar con la huella de duplicados', () => {
    const documents = buildDocuments(books, { count: 300 });

    expect(new Set(documents.map((doc) => sha(doc.content))).size).toBe(300);
    expect(new Set(documents.map((doc) => doc.filename)).size).toBe(300);
  });

  it('cumple los limites de metadatos de la API', () => {
    for (const doc of buildDocuments(books, { count: 100 })) {
      expect(doc.title.length).toBeLessThanOrEqual(200);
      expect(doc.author.length).toBeLessThanOrEqual(100);
      expect(doc.category.length).toBeLessThanOrEqual(50);
      expect(doc.tags.length).toBeLessThanOrEqual(10);
      expect(new Set(doc.tags).size).toBe(doc.tags.length);
      expect(doc.version).toMatch(/^\d+(\.\d+){0,2}$/);
    }
  });

  it('el perfil mixed es de mayoria pequenos con una parte en el tope de 300.000 caracteres', () => {
    const documents = buildDocuments(books, { count: 500, profile: 'mixed' });

    const sizes = documents.map((doc) => doc.content.length);
    const small = sizes.filter((size) => size <= 21_000).length;
    const atCap = sizes.filter((size) => size >= 299_000 && size <= 301_000).length;
    expect(small / sizes.length).toBeGreaterThan(0.7);
    expect(atCap / sizes.length).toBeGreaterThan(0.03);
    expect(atCap / sizes.length).toBeLessThan(0.15);
  });

  it('el perfil demo incluye Markdown con titulo y documentos largos para el visor', () => {
    const documents = buildDocuments(books, { count: 60, profile: 'demo' });

    const markdown = documents.filter((doc) => doc.format === 'MARKDOWN');
    expect(markdown.length).toBeGreaterThan(0);
    expect(markdown.every((doc) => doc.filename.endsWith('.md') && doc.content.startsWith('# '))).toBe(true);
    expect(documents.some((doc) => doc.content.length > 60_000)).toBe(true);
    expect(documents.every((doc) => doc.content.length < 140_000)).toBe(true);
  });

  it('rechaza un corpus demasiado corto', () => {
    expect(() => buildDocuments(['texto corto'], { count: 1 })).toThrow('demasiado corto');
    expect(() => buildDocuments([], { count: 1 })).toThrow('demasiado corto');
  });
});

describe('loadCorpus', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'corpus-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const okResponse = (text: string): ReturnType<FetchText> =>
    Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(text) });

  it('descarga solo los libros que faltan y los guarda sin las marcas', async () => {
    writeFileSync(join(dir, `book${GUTENBERG_BOOKS[0].id}.txt`), 'ya descargado', 'utf8');
    const fetchText = jest.fn<ReturnType<FetchText>, [string]>((url) =>
      okResponse(`*** START OF THE PROJECT GUTENBERG EBOOK X ***\ncontenido de ${url}\n*** END OF THE PROJECT GUTENBERG EBOOK X ***`),
    );

    const loaded = await loadCorpus(dir, fetchText);

    expect(fetchText).toHaveBeenCalledTimes(GUTENBERG_BOOKS.length - 1);
    expect(loaded).toHaveLength(GUTENBERG_BOOKS.length);
    expect(loaded[0]).toBe('ya descargado');
    expect(loaded[1]).toContain('contenido de https://www.gutenberg.org/cache/epub/17073/pg17073.txt');
    expect(loaded[1]).not.toContain('START OF');
    expect(readdirSync(dir)).toHaveLength(GUTENBERG_BOOKS.length);
  });

  it('no vuelve a descargar si el corpus ya esta en disco', async () => {
    const fetchText = jest.fn<ReturnType<FetchText>, [string]>(() => okResponse('texto'));
    await loadCorpus(dir, fetchText);
    fetchText.mockClear();

    await loadCorpus(dir, fetchText);

    expect(fetchText).not.toHaveBeenCalled();
  });

  it('falla con un mensaje claro si la descarga responde con error', async () => {
    const fetchText: FetchText = () => Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });

    await expect(loadCorpus(dir, fetchText)).rejects.toThrow('HTTP 503');
  });
});
