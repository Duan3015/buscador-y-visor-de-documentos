import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Corpus de prueba: libros en espanol de dominio publico (Project Gutenberg). Se descargan una
 * vez a una carpeta ignorada por Git; no se incluyen en el repositorio.
 */
export const GUTENBERG_BOOKS = [
  { id: 2000, label: 'Quijote' },
  { id: 17073, label: 'Regenta' },
  { id: 14329, label: 'Viajes' },
  { id: 24536, label: 'Jinetes' },
  { id: 57303, label: 'Divina Comedia' },
  { id: 49836, label: 'Niebla' },
] as const;

export type FetchText = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const START_MARK = /\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i;
const END_MARK = /\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i;

/** Conserva solo el texto entre las marcas de inicio y fin de Gutenberg, con saltos de linea LF. */
export function stripGutenberg(raw: string): string {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const start = START_MARK.exec(text);
  const end = END_MARK.exec(text);
  const from = start ? start.index + start[0].length : 0;
  const to = end && end.index > from ? end.index : text.length;
  return text.slice(from, to).trim();
}

/** Descarga los libros que falten y devuelve el corpus completo (un texto por libro). */
export async function loadCorpus(cacheDir: string, fetchText: FetchText, log: (message: string) => void = () => undefined): Promise<string[]> {
  mkdirSync(cacheDir, { recursive: true });
  const books: string[] = [];
  for (const book of GUTENBERG_BOOKS) {
    const file = join(cacheDir, `book${book.id}.txt`);
    if (!existsSync(file)) {
      const url = `https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.txt`;
      log(`Descargando ${book.label} (${url})`);
      const response = await fetchText(url);
      if (!response.ok) throw new Error(`No se pudo descargar ${url}: HTTP ${response.status}`);
      writeFileSync(file, stripGutenberg(await response.text()), 'utf8');
    }
    books.push(readFileSync(file, 'utf8'));
  }
  return books;
}

export type Profile = 'mixed' | 'demo';

export interface GeneratedDocument {
  title: string;
  author: string;
  category: string;
  tags: string[];
  version?: string;
  filename: string;
  format: 'TXT' | 'MARKDOWN';
  content: string;
}

interface SizeBand {
  weight: number;
  min: number;
  max: number;
}

/**
 * Perfil "mixed" del benchmark (ADR-13): la mayoria pequenos, una parte en el tope de indexacion
 * (300.000 caracteres, el peor caso de ADR-03). Perfil "demo": documentos legibles y variados.
 */
const BANDS: Record<Profile, SizeBand[]> = {
  mixed: [
    { weight: 80, min: 2_000, max: 20_000 },
    { weight: 12, min: 20_000, max: 100_000 },
    { weight: 8, min: 300_000, max: 300_000 },
  ],
  demo: [
    { weight: 80, min: 3_000, max: 30_000 },
    { weight: 20, min: 60_000, max: 130_000 },
  ],
};

const AUTHORS = ['Ana Perez', 'Luis Gomez', 'Marta Rios', 'Carlos Vega', 'Sofia Duran', 'Andres Mora', 'Lucia Prado', 'Diego Salas'];
const CATEGORIES = ['Manuales', 'Guias', 'Procedimientos', 'Referencias', 'Notas tecnicas'];
const TAGS = ['infraestructura', 'seguridad', 'operacion', 'arquitectura', 'datos', 'redes', 'calidad', 'despliegue'];

/** Generador pseudoaleatorio determinista (mulberry32): la misma semilla produce el mismo conjunto. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickBand(bands: SizeBand[], random: () => number): SizeBand {
  const total = bands.reduce((sum, band) => sum + band.weight, 0);
  let roll = random() * total;
  for (const band of bands) {
    roll -= band.weight;
    if (roll < 0) return band;
  }
  return bands[bands.length - 1] as SizeBand;
}

/** No parte una palabra ni un caracter fuera del plano basico por la mitad. */
function alignStart(text: string, index: number): number {
  const paragraph = text.indexOf('\n\n', index);
  if (paragraph !== -1 && paragraph - index < 2_000) return paragraph + 2;
  const space = text.indexOf(' ', index);
  return space === -1 ? index : space + 1;
}

export interface BuildOptions {
  count: number;
  seed?: number;
  profile?: Profile;
}

/**
 * Construye documentos como rebanadas deterministas del corpus. Cada documento tiene un contenido
 * distinto (la API rechaza duplicados por huella SHA-256).
 */
export function buildDocuments(books: readonly string[], { count, seed = 20260929, profile = 'mixed' }: BuildOptions): GeneratedDocument[] {
  // Se trabaja sobre el corpus completo (libros unidos), como en la evidencia de capacidad de FTS.
  const corpus = books.join('\n\n');
  if (corpus.length < 1_000_000) {
    throw new Error('El corpus es demasiado corto para generar documentos de hasta 300.000 caracteres');
  }
  const bookStarts: number[] = [];
  let offset = 0;
  for (const book of books) {
    bookStarts.push(offset);
    offset += book.length + 2;
  }
  const labelAt = (position: number): string => {
    let bookIndex = 0;
    bookStarts.forEach((bookStart, index) => {
      if (bookStart <= position) bookIndex = index;
    });
    return GUTENBERG_BOOKS[bookIndex]?.label ?? 'Libro';
  };
  const random = createRandom(seed);
  const seen = new Set<string>();
  const documents: GeneratedDocument[] = [];

  for (let index = 0; index < count; index++) {
    const band = pickBand(BANDS[profile], random);
    const size = band.min + Math.floor(random() * (band.max - band.min + 1));
    let start = alignStart(corpus, Math.floor(random() * (corpus.length - size - 2_500)));
    const label = labelAt(start);
    let content = corpus.slice(start, start + size).trim();
    // Garantiza unicidad de contenido: en el caso improbable de repetirse, se desplaza el inicio.
    for (let attempt = 0; attempt < 50; attempt++) {
      const fingerprint = createHash('sha256').update(content).digest('hex');
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        break;
      }
      start += 1;
      content = corpus.slice(start, start + size).trim();
    }

    const number = String(index + 1).padStart(5, '0');
    const markdown = profile === 'demo' ? index % 7 === 3 : index % 10 === 4;
    const title = `${label} - fragmento ${number}`;
    documents.push({
      title,
      author: AUTHORS[Math.floor(random() * AUTHORS.length)] as string,
      category: CATEGORIES[Math.floor(random() * CATEGORIES.length)] as string,
      tags: [TAGS[Math.floor(random() * TAGS.length)] as string, TAGS[Math.floor(random() * TAGS.length)] as string].filter(
        (tag, position, all) => all.indexOf(tag) === position,
      ),
      version: `${1 + Math.floor(random() * 3)}.${Math.floor(random() * 10)}`,
      filename: `fragmento-${number}.${markdown ? 'md' : 'txt'}`,
      format: markdown ? 'MARKDOWN' : 'TXT',
      content: markdown ? `# ${title}\n\n${content}\n` : `${content}\n`,
    });
  }
  return documents;
}
