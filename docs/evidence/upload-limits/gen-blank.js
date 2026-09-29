// PDFs con muchas paginas y casi sin texto (por ejemplo, planos o diagramas): peor caso para el limite por caracteres.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const out = path.join(__dirname, 'pdfs');

function build(name, pages) {
  return new Promise((resolve) => {
    const file = path.join(out, name);
    const doc = new PDFDocument({ size: 'A4', margin: 50, autoFirstPage: false });
    const ws = fs.createWriteStream(file);
    doc.pipe(ws);
    for (let i = 0; i < pages; i++) {
      doc.addPage();
      doc.fontSize(10).text('Pagina ' + (i + 1), 50, 50);
    }
    doc.end();
    ws.on('finish', () => {
      console.log(`${name}: ${pages} paginas, ${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB`);
      resolve();
    });
  });
}

(async () => {
  await build('casi-vacio-5000p.pdf', 5000);
  await build('casi-vacio-20000p.pdf', 20000);
})();
