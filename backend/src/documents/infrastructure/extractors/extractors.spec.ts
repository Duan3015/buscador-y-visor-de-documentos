import { buildCorruptPdf, buildPdf } from '../../../../test/fixtures/pdf-builder';
import { DocumentProcessingError } from '../../domain/processing-error';
import type { ExtractionLimits } from '../../domain/ports';
import { CompositeTextExtractor } from './composite-text-extractor';
import { PdfTextExtractor } from './pdf-text-extractor';
import { PlainTextExtractor } from './plain-text-extractor';

const limits: ExtractionLimits = { maxPages: 5, maxChars: 10_000, timeoutMs: 20_000 };

async function failureOf(promise: Promise<unknown>): Promise<DocumentProcessingError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DocumentProcessingError) return error;
    throw error;
  }
  throw new Error('Se esperaba un DocumentProcessingError');
}

describe('PlainTextExtractor', () => {
  const extractor = new PlainTextExtractor();

  it('decodifica UTF-8 y normaliza el texto', async () => {
    const data = Buffer.from('\uFEFFInstalaci\u00f3n\r\ndel servidor\u0000', 'utf8');
    await expect(extractor.extract(data, limits)).resolves.toBe('Instalaci\u00f3n\ndel servidor');
  });

  it('rechaza un texto que no es UTF-8 valido (E-10)', async () => {
    const latin1 = Buffer.from([0x49, 0x6e, 0x73, 0x74, 0x61, 0x6c, 0x61, 0x63, 0x69, 0xf3, 0x6e]);
    const error = await failureOf(extractor.extract(latin1, limits));
    expect(error.code).toBe('ENCODING_UNSUPPORTED');
    expect(error.permanent).toBe(true);
  });

  it('rechaza un texto que solo tiene espacios (E-08)', async () => {
    const error = await failureOf(extractor.extract(Buffer.from('  \n\t \n'), limits));
    expect(error.code).toBe('NO_EXTRACTABLE_TEXT');
  });

  it('rechaza un texto que supera el maximo de caracteres (E-36)', async () => {
    const error = await failureOf(extractor.extract(Buffer.from('a'.repeat(10_001)), limits));
    expect(error.code).toBe('TEXT_TOO_LARGE');
    expect(error.permanent).toBe(true);
  });
});

describe('PdfTextExtractor (pdfjs-dist, integracion con PDFs reales)', () => {
  const extractor = new PdfTextExtractor();

  it('extrae el texto de todas las paginas separadas por una linea en blanco', async () => {
    const pdf = buildPdf({ pages: ['Manual de instalacion', 'Segunda pagina con texto'] });
    const text = await extractor.extract(pdf, limits);
    expect(text).toContain('Manual de instalacion');
    expect(text).toContain('Segunda pagina con texto');
    expect(text.indexOf('Manual')).toBeLessThan(text.indexOf('Segunda'));
    expect(text).toMatch(/\n\n/);
  });

  it('extrae caracteres acentuados', async () => {
    const pdf = buildPdf({ pages: ['Configuraci\u00f3n r\u00e1pida'] });
    await expect(extractor.extract(pdf, limits)).resolves.toContain('Configuraci\u00f3n r\u00e1pida');
  });

  it('rechaza un PDF sin capa de texto (E-08)', async () => {
    const error = await failureOf(extractor.extract(buildPdf({ pages: [null] }), limits));
    expect(error.code).toBe('NO_EXTRACTABLE_TEXT');
    expect(error.permanent).toBe(true);
  });

  it('rechaza un PDF cifrado (E-09)', async () => {
    const error = await failureOf(extractor.extract(buildPdf({ pages: ['secreto'], encrypted: true }), limits));
    expect(error.code).toBe('PDF_ENCRYPTED');
    expect(error.permanent).toBe(true);
  });

  it('rechaza un PDF danado (E-09)', async () => {
    const error = await failureOf(extractor.extract(buildCorruptPdf(), limits));
    expect(error.code).toBe('PDF_CORRUPT');
    expect(error.permanent).toBe(true);
  });

  it('rechaza un PDF con demasiadas paginas (E-35)', async () => {
    const pdf = buildPdf({ pages: Array.from({ length: 6 }, (_, i) => `Pagina ${i + 1}`) });
    const error = await failureOf(extractor.extract(pdf, limits));
    expect(error.code).toBe('PDF_TOO_MANY_PAGES');
    expect(error.permanent).toBe(true);
  });

  it('rechaza un PDF cuyo texto supera el maximo de caracteres (E-36)', async () => {
    const block = Array.from({ length: 8 }, () => 'x'.repeat(40)).join('\n');
    const pdf = buildPdf({ pages: [block, block] });
    const error = await failureOf(extractor.extract(pdf, { ...limits, maxChars: 300 }));
    expect(error.code).toBe('TEXT_TOO_LARGE');
  });

  it('un plazo agotado es un fallo transitorio para que la cola reintente (E-37)', async () => {
    const pdf = buildPdf({ pages: ['uno', 'dos', 'tres'] });
    const error = await failureOf(extractor.extract(pdf, { ...limits, timeoutMs: 1 }));
    expect(error.code).toBe('EXTRACTION_TIMEOUT');
    expect(error.permanent).toBe(false);
  });

  it('no altera el buffer recibido', async () => {
    const pdf = buildPdf({ pages: ['contenido'] });
    const before = Buffer.from(pdf);
    await extractor.extract(pdf, limits);
    expect(pdf.equals(before)).toBe(true);
  });
});

describe('CompositeTextExtractor', () => {
  const composite = new CompositeTextExtractor([new PlainTextExtractor(), new PdfTextExtractor()]);

  it('usa la estrategia de cada formato', async () => {
    await expect(composite.extract('MARKDOWN', Buffer.from('# Hola'), limits)).resolves.toBe('# Hola');
    await expect(composite.extract('PDF', buildPdf({ pages: ['desde pdf'] }), limits)).resolves.toContain('desde pdf');
  });

  it('falla si no hay estrategia registrada para el formato', async () => {
    const empty = new CompositeTextExtractor([]);
    await expect(empty.extract('TXT', Buffer.from('x'), limits)).rejects.toThrow('No hay extractor');
  });
});
