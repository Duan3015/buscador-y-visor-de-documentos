/**
 * Generador de PDFs minimos para pruebas y demostracion. Produce archivos validos con tablas de
 * referencias correctas, sin dependencias externas.
 */

export interface PdfOptions {
  /** Texto de cada pagina. `null` genera una pagina sin capa de texto (solo un grafico). */
  pages: (string | null)[];
  /** Agrega un diccionario de cifrado invalido para que el PDF exija contrasena. */
  encrypted?: boolean;
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function toLatin1(text: string): string {
  // Las fuentes estandar usan WinAnsi: se aceptan caracteres latinos basicos y acentuados.
  return text;
}

function contentStream(text: string | null): string {
  if (text === null) {
    return '0.8 g 50 50 200 100 re f';
  }
  const lines = text.split('\n');
  const body = lines
    .map((line, index) => `${index === 0 ? '' : 'T* '}(${escapePdfText(toLatin1(line))}) Tj`)
    .join('\n');
  return `BT /F1 12 Tf 14 TL 50 740 Td\n${body}\nET`;
}

export function buildPdf(options: PdfOptions): Buffer {
  const objects: string[] = [];
  const pageCount = options.pages.length;
  const pageObjectNumbers = options.pages.map((_, index) => 4 + index * 2);
  const kids = pageObjectNumbers.map((n) => `${n} 0 R`).join(' ');

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  options.pages.forEach((text, index) => {
    const pageNumber = 4 + index * 2;
    const contentNumber = pageNumber + 1;
    const stream = contentStream(text);
    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`;
    objects[contentNumber] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let encryptRef = '';
  if (options.encrypted) {
    const encryptNumber = objects.length;
    const hex32 = 'A'.repeat(64);
    objects[encryptNumber] = `<< /Filter /Standard /V 1 /R 2 /O <${hex32}> /U <${hex32}> /P -4 >>`;
    encryptRef = ` /Encrypt ${encryptNumber} 0 R /ID [<00112233445566778899AABBCCDDEEFF> <00112233445566778899AABBCCDDEEFF>]`;
  }

  let output = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = Buffer.byteLength(output, 'latin1');
    output += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let number = 1; number < objects.length; number += 1) {
    output += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R${encryptRef} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}

/** PDF con firma correcta pero contenido truncado: no se puede leer. */
export function buildCorruptPdf(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 99 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n', 'latin1');
}
