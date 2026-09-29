// Extrae el texto de un PDF con pdfjs-dist y reporta tiempo y memoria.
// Uso: node extract.mjs <archivo.pdf> [maxChars]
import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const lag = monitorEventLoopDelay({ resolution: 5 });
lag.enable();

const file = process.argv[2];
const maxChars = process.argv[3] ? Number(process.argv[3]) : Infinity;

const rss0 = process.memoryUsage().rss;
let rssPeak = rss0;
const timer = setInterval(() => {
  rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
}, 20);

const t0 = performance.now();
const data = new Uint8Array(fs.readFileSync(file));
const size = data.length;
const loading = getDocument({
  data,
  useSystemFonts: true,
  disableFontFace: true,
  isEvalSupported: false,
  verbosity: 0,
});
const pdf = await loading.promise;
const tLoad = performance.now() - t0;
const numPages = pdf.numPages;

let chars = 0;
let pagesRead = 0;
const t1 = performance.now();
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const content = await page.getTextContent();
  const text = content.items.map((i) => ('str' in i ? i.str : '')).join(' ');
  chars += text.length;
  pagesRead++;
  page.cleanup();
  rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
  if (chars >= maxChars) break;
}
const tExtract = performance.now() - t1;
clearInterval(timer);
await loading.destroy();

console.log(
  JSON.stringify({
    archivo: file.split(/[\\/]/).pop(),
    mb: +(size / 1024 / 1024).toFixed(2),
    paginas_totales: numPages,
    paginas_leidas: pagesRead,
    caracteres: chars,
    carga_ms: Math.round(tLoad),
    extraccion_ms: Math.round(tExtract),
    ms_por_pagina: +(tExtract / pagesRead).toFixed(2),
    rss_inicial_mb: Math.round(rss0 / 1024 / 1024),
    rss_pico_mb: Math.round(rssPeak / 1024 / 1024),
    bloqueo_hilo_max_ms: Math.round(lag.max / 1e6),
    bloqueo_hilo_p99_ms: Math.round(lag.percentile(99) / 1e6),
  }),
);
