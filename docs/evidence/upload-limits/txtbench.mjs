import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = 'El sistema de gestion documental permite buscar contenido tecnico con acentuacion, ñandú y más. \r\n';
for (const mb of [1, 3, 5]) {
  const target = mb * 1024 * 1024;
  let s = ''; while (Buffer.byteLength(s) < target) s += base.repeat(2000);
  const buf = Buffer.from(s).subarray(0, target);
  writeFileSync('t.txt', buf);
  const t0 = performance.now();
  const raw = readFileSync('t.txt');
  const h = createHash('sha256').update(raw).digest('hex');
  const text = raw.toString('utf8').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').normalize('NFC');
  const ms = performance.now() - t0;
  console.log(JSON.stringify({ mb, bytes: raw.length, chars: text.length, leer_hash_normalizar_ms: Math.round(ms), rss_mb: Math.round(process.memoryUsage().rss/1048576) }));
}
