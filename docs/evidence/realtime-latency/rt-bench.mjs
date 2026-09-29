// Mide la latencia de entrega de eventos de estado: NOTIFY transaccional de PostgreSQL -> proceso backend -> N clientes SSE.
// Uso: node rt-bench.mjs <clientesSSE> <eventos>
import http from 'node:http';
import pg from 'pg';

const NCLIENTS = Number(process.argv[2] ?? 1);
const NEVENTS = Number(process.argv[3] ?? 500);
const CONN = 'postgres://postgres:probe@localhost:55432/postgres';

const listener = new pg.Client({ connectionString: CONN });
const writer = new pg.Client({ connectionString: CONN });
await listener.connect();
await writer.connect();
await listener.query('LISTEN doc_events');

const sseClients = new Set();
const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const notifyLat = [];
const e2eLat = [];
let expected = 0;
let received = 0;
let doneResolve;
const done = new Promise((r) => (doneResolve = r));

listener.on('notification', (msg) => {
  const now = performance.now();
  const { t } = JSON.parse(msg.payload);
  notifyLat.push(now - t);
  const frame = `event: document-status\nid: ${msg.payload.length}\ndata: ${msg.payload}\n\n`;
  for (const res of sseClients) res.write(frame);
});

const agent = new http.Agent({ keepAlive: true, maxSockets: NCLIENTS + 10 });
let connected = 0;
await new Promise(async (resolve) => {
  for (let i = 0; i < NCLIENTS; i++) {
    while (i - connected >= 50) await new Promise((r) => setTimeout(r, 5));
    http.get({ port, path: '/events', agent }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const m = frame.match(/data: (.*)/);
          if (m) {
            e2eLat.push(performance.now() - JSON.parse(m[1]).t);
            received++;
            if (received >= expected) doneResolve();
          }
        }
      });
      if (++connected === NCLIENTS) resolve();
    });
  }
});

expected = NEVENTS * NCLIENTS;
const rssBefore = process.memoryUsage().rss;
for (let i = 0; i < NEVENTS; i++) {
  const payload = JSON.stringify({ documentId: `doc-${i}`, status: 'INDEXADO', t: performance.now() });
  await writer.query('BEGIN');
  await writer.query("SELECT pg_notify('doc_events', $1)", [payload]);
  await writer.query('COMMIT');
  await new Promise((r) => setTimeout(r, 5));
}
await Promise.race([done, new Promise((r) => setTimeout(r, 10000))]);

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? Number(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(2)) : null;
};
console.log(
  JSON.stringify({
    clientes_sse: NCLIENTS,
    eventos: NEVENTS,
    entregas_esperadas: expected,
    entregas_recibidas: received,
    notify_a_backend_ms: { p50: pct(notifyLat, 50), p95: pct(notifyLat, 95), max: pct(notifyLat, 100) },
    notify_a_cliente_sse_ms: { p50: pct(e2eLat, 50), p95: pct(e2eLat, 95), p99: pct(e2eLat, 99), max: pct(e2eLat, 100) },
    rss_mb_antes: Math.round(rssBefore / 1048576),
    rss_mb_despues: Math.round(process.memoryUsage().rss / 1048576),
  }),
);
for (const res of sseClients) res.end();
agent.destroy();
server.close();
await listener.end();
await writer.end();
process.exit(0);

