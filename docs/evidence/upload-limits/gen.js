// Genera PDFs sinteticos de prueba con texto en espanol (aprox. 2600 caracteres por pagina).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

const out = path.join(__dirname, 'pdfs');
fs.mkdirSync(out, { recursive: true });

const book = fs
  .readFileSync(path.join(process.env.TEMP, 'kataprobe', 'book2000.txt'), 'utf8')
  .replace(/\s+/g, ' ');

const CHARS_PER_PAGE = 2600;

function pageText(i) {
  const start = (i * CHARS_PER_PAGE) % (book.length - CHARS_PER_PAGE);
  return book.substr(start, CHARS_PER_PAGE);
}

// PNG de ruido aleatorio (incomprimible): pesa aproximadamente w*h*3 bytes.
function noisePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const off = y * (w * 3 + 1);
    raw[off] = 0;
    crypto.randomFillSync(raw, off + 1, w * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 1 });
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function build(name, pages, imageEvery, imageSize) {
  return new Promise((resolve) => {
    const file = path.join(out, name);
    const doc = new PDFDocument({ size: 'A4', margin: 50, autoFirstPage: false });
    const ws = fs.createWriteStream(file);
    doc.pipe(ws);
    const img = imageEvery ? noisePng(imageSize, imageSize) : null;
    for (let i = 0; i < pages; i++) {
      doc.addPage();
      doc.fontSize(10).text(pageText(i), { width: 495, align: 'left' });
      if (img && i % imageEvery === 0) doc.image(img, 50, 400, { width: 200 });
    }
    doc.end();
    ws.on('finish', () => {
      const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(2);
      console.log(`${name}: ${pages} paginas, ${mb} MB`);
      resolve();
    });
  });
}

(async () => {
  await build('texto-10p.pdf', 10, 0, 0);
  await build('texto-50p.pdf', 50, 0, 0);
  await build('texto-115p.pdf', 115, 0, 0);
  await build('texto-250p.pdf', 250, 0, 0);
  await build('texto-500p.pdf', 500, 0, 0);
  await build('texto-1000p.pdf', 1000, 0, 0);
  // Documentos pesados por imagenes, con poco texto.
  await build('imagenes-30p-aprox20MB.pdf', 30, 4, 1000);
})();
