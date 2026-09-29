const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { Writable } = require('stream');

function hashBuffer(buf) {
  const t0 = process.hrtime.bigint();
  const h = crypto.createHash('sha256').update(buf).digest('hex');
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { h, ms };
}

async function hashStream(buf, chunkSize) {
  const hash = crypto.createHash('sha256');
  const t0 = process.hrtime.bigint();
  async function* gen() {
    for (let i = 0; i < buf.length; i += chunkSize) yield buf.subarray(i, i + chunkSize);
  }
  await pipeline(
    Readable.from(gen()),
    new Writable({
      write(chunk, _enc, cb) {
        hash.update(chunk);
        cb();
      },
    }),
  );
  hash.digest('hex');
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

(async () => {
  console.log('node', process.version);
  for (const mb of [1, 5, 20, 50, 100]) {
    const buf = crypto.randomBytes(mb * 1024 * 1024);
    hashBuffer(buf); // calentamiento
    const runs = [];
    for (let i = 0; i < 5; i++) runs.push(hashBuffer(buf).ms);
    runs.sort((a, b) => a - b);
    const med = runs[Math.floor(runs.length / 2)];
    const streamMs = await hashStream(buf, 64 * 1024);
    console.log(
      `${String(mb).padStart(4)} MB  buffer: ${med.toFixed(1)} ms (${((mb / med) * 1000).toFixed(0)} MB/s)  stream 64KB: ${streamMs.toFixed(1)} ms`,
    );
  }
})();
