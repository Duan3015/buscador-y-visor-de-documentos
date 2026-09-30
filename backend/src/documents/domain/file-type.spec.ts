import { UnsupportedMediaTypeError } from '../../shared-kernel/errors';
import { HEAD_SAMPLE_BYTES, detectFormat } from './file-type';

const pdfHead = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj');
const textHead = Buffer.from('# Titulo\n\nContenido de prueba');

describe('detectFormat (E-01, ADR-10)', () => {
  it('reconoce un PDF por su firma', () => {
    expect(detectFormat(pdfHead, 'manual.pdf')).toBe('PDF');
  });

  it('reconoce la firma PDF aunque haya bytes previos dentro de los primeros 1024', () => {
    const head = Buffer.concat([Buffer.alloc(500, 0x20), pdfHead]);
    expect(detectFormat(head, 'manual.PDF')).toBe('PDF');
  });

  it('rechaza la firma PDF pasados los primeros 1024 bytes', () => {
    const head = Buffer.concat([Buffer.alloc(HEAD_SAMPLE_BYTES, 0x20), pdfHead]);
    expect(() => detectFormat(head, 'manual.pdf')).toThrow(UnsupportedMediaTypeError);
  });

  it.each([
    ['notas.txt', 'TXT'],
    ['LEEME.TXT', 'TXT'],
    ['guia.md', 'MARKDOWN'],
    ['guia.markdown', 'MARKDOWN'],
  ])('reconoce %s como %s', (name, format) => {
    expect(detectFormat(textHead, name)).toBe(format);
  });

  it('rechaza un archivo .pdf cuyo contenido es texto (extension enganosa)', () => {
    expect(() => detectFormat(textHead, 'falso.pdf')).toThrow(UnsupportedMediaTypeError);
  });

  it('rechaza un PDF renombrado como .txt', () => {
    expect(() => detectFormat(pdfHead, 'falso.txt')).toThrow(UnsupportedMediaTypeError);
  });

  it('rechaza un binario renombrado como texto (byte nulo)', () => {
    const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(() => detectFormat(binary, 'datos.txt')).toThrow(UnsupportedMediaTypeError);
  });

  it.each(['programa.exe', 'imagen.png', 'sinextension', '.txt.exe'])(
    'rechaza la extension no admitida %s',
    (name) => {
      expect(() => detectFormat(textHead, name)).toThrow(UnsupportedMediaTypeError);
    },
  );

  it('acepta un texto vacio de muestra siempre que la extension sea de texto', () => {
    expect(detectFormat(Buffer.alloc(0), 'vacio.txt')).toBe('TXT');
  });
});
