import { rmSync } from 'node:fs';
import request from 'supertest';
import { startTestApp, type TestApp } from './harness';

const metadata = {
  title: 'Guia de instalacion',
  author: 'Ana Perez',
  category: 'Manuales',
  tags: 'nestjs',
  version: '1.2',
};

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');

function upload(t: TestApp, file: { content: Buffer | string; name: string } | null, fields: Record<string, string> = metadata) {
  const req = request(t.server).post('/api/documents');
  for (const [key, value] of Object.entries(fields)) req.field(key, value);
  if (file) req.attach('file', Buffer.from(file.content), file.name);
  return req;
}

describe('POST /api/documents (integracion)', () => {
  let t: TestApp;

  beforeAll(async () => {
    rmSync(process.env.STORAGE_DIR as string, { recursive: true, force: true });
    t = await startTestApp({ maxUploadBytesText: 2048, maxUploadBytesPdf: 4096 });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await t.reset();
  });

  afterEach(() => {
    // Ningun camino, exitoso o fallido, debe dejar temporales (E-43).
    expect(t.tempFiles()).toEqual([]);
  });

  it('acepta un TXT: 202, PROCESANDO, Location, registro, archivo y trabajo encolado (HU-01)', async () => {
    const response = await upload(t, { content: 'contenido de la guia', name: 'guia.txt' });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ id: expect.any(String), status: 'PROCESANDO' });
    expect(response.headers.location).toBe(`/api/documents/${response.body.id}`);

    const row = await t.pool.query('SELECT * FROM documents WHERE id = $1', [response.body.id]);
    expect(row.rows[0]).toMatchObject({
      status: 'PROCESANDO',
      format: 'TXT',
      title: 'Guia de instalacion',
      tags: ['nestjs'],
      version: '1.2',
      original_filename: 'guia.txt',
    });
    expect(t.storedFiles()).toEqual([response.body.id]);
    expect(await t.countJobs()).toBe(1);
  });

  it('acepta un PDF y un Markdown', async () => {
    const pdf = await upload(t, { content: PDF_BYTES, name: 'manual.pdf' });
    const md = await upload(t, { content: '# Titulo\n\ntexto', name: 'notas.md' }, { ...metadata, title: 'Notas' });
    expect(pdf.status).toBe(202);
    expect(md.status).toBe(202);
    const formats = await t.pool.query('SELECT format FROM documents ORDER BY format');
    expect(formats.rows.map((r) => r.format)).toEqual(['MARKDOWN', 'PDF']);
  });

  it('acepta las etiquetas como campos repetidos', async () => {
    const response = await request(t.server)
      .post('/api/documents')
      .field('title', 'T')
      .field('author', 'A')
      .field('category', 'C')
      .field('tags', 'uno')
      .field('tags', 'dos')
      .attach('file', Buffer.from('x'), 'a.txt');
    expect(response.status).toBe(202);
    const row = await t.pool.query('SELECT tags FROM documents WHERE id = $1', [response.body.id]);
    expect(row.rows[0].tags).toEqual(['uno', 'dos']);
  });

  it('rechaza metadatos invalidos con errores por campo y sin efectos secundarios (E-03)', async () => {
    const response = await upload(t, { content: 'hola', name: 'a.txt' }, { author: 'Ana', category: 'X', version: 'v1' });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['title', 'version']);
    expect(t.storedFiles()).toEqual([]);
    expect(await t.countJobs()).toBe(0);
  });

  it('rechaza campos desconocidos (E-48)', async () => {
    const response = await upload(t, { content: 'hola', name: 'a.txt' }, { ...metadata, admin: 'true' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('rechaza un archivo enviado en un campo distinto de "file" (E-48)', async () => {
    const response = await request(t.server)
      .post('/api/documents')
      .field('title', 'T')
      .field('author', 'A')
      .field('category', 'C')
      .attach('otro', Buffer.from('x'), 'a.txt');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('exige el archivo (FILE_REQUIRED)', async () => {
    const response = await upload(t, null);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('FILE_REQUIRED');
  });

  it('rechaza un archivo vacio (E-04)', async () => {
    const response = await upload(t, { content: '', name: 'vacio.txt' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('EMPTY_FILE');
  });

  it('rechaza con 415 un archivo cuyo contenido no coincide con su extension (E-01)', async () => {
    const response = await upload(t, { content: 'esto es texto', name: 'falso.pdf' });
    expect(response.status).toBe(415);
    expect(response.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(t.storedFiles()).toEqual([]);
  });

  it('rechaza con 415 un binario renombrado como TXT (E-01)', async () => {
    const response = await upload(t, { content: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]), name: 'datos.txt' });
    expect(response.status).toBe(415);
  });

  it('rechaza con 413 un texto que supera el limite y no deja temporales (E-02)', async () => {
    const response = await upload(t, { content: 'a'.repeat(2049), name: 'grande.txt' });
    expect(response.status).toBe(413);
    expect(response.body.code).toBe('FILE_TOO_LARGE');
    expect(t.storedFiles()).toEqual([]);
  });

  it('aplica un limite distinto a los PDF (E-02)', async () => {
    const withinPdfLimit = Buffer.concat([PDF_BYTES, Buffer.alloc(3000, 0x20)]);
    const ok = await upload(t, { content: withinPdfLimit, name: 'ok.pdf' });
    expect(ok.status).toBe(202);

    const tooBig = Buffer.concat([PDF_BYTES, Buffer.alloc(5000, 0x20)]);
    const rejected = await upload(t, { content: tooBig, name: 'grande.pdf' }, { ...metadata, title: 'Otro' });
    expect(rejected.status).toBe(413);
  });

  it('responde 409 con el documento existente al repetir el contenido (E-05)', async () => {
    const first = await upload(t, { content: 'mismo contenido', name: 'a.txt' });
    const second = await upload(t, { content: 'mismo contenido', name: 'b.txt' }, { ...metadata, title: 'Otro titulo' });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DUPLICATE_DOCUMENT');
    expect(second.body.existing).toEqual({ id: first.body.id, status: 'PROCESANDO' });
    expect(t.storedFiles()).toEqual([first.body.id]);
    expect(await t.countJobs()).toBe(1);
  });

  it('dos cargas simultaneas del mismo archivo: una 202 y una 409, sin huerfanos (E-33)', async () => {
    const [a, b] = await Promise.all([
      upload(t, { content: 'contenido concurrente', name: 'a.txt' }),
      upload(t, { content: 'contenido concurrente', name: 'b.txt' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([202, 409]);
    const count = await t.pool.query('SELECT count(*)::int AS total FROM documents');
    expect(count.rows[0].total).toBe(1);
    expect(t.storedFiles()).toHaveLength(1);
    expect(await t.countJobs()).toBe(1);
  });

  it('no usa el nombre original en la ruta del archivo (E-06)', async () => {
    const response = await upload(t, { content: 'texto', name: '..%2F..%2Fescape.txt' });
    expect(response.status).toBe(202);
    expect(t.storedFiles()).toEqual([response.body.id]);
  });

  it('devuelve la traza propia del cliente y descarta una invalida (E-48)', async () => {
    const valid = await upload(t, null).set('X-Request-Id', 'cliente-trace-01');
    expect(valid.headers['x-request-id']).toBe('cliente-trace-01');
    expect(valid.body.traceId).toBe('cliente-trace-01');

    const invalid = await upload(t, null).set('X-Request-Id', 'corto');
    expect(invalid.headers['x-request-id']).not.toBe('corto');
    expect(invalid.body.traceId).toBe(invalid.headers['x-request-id']);
  });

  it('responde 404 en formato Problem Details para una ruta inexistente', async () => {
    const response = await request(t.server).get('/api/no-existe');
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('incluye las cabeceras de seguridad de helmet', async () => {
    const response = await request(t.server).get('/api/no-existe');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('un fallo al encolar deja la base de datos y el disco sin residuos (E-30, E-38)', async () => {
    // Se fuerza el fallo bloqueando la insercion de trabajos en la tabla de la cola.
    await t.pool.query('ALTER TABLE pgboss.job ADD CONSTRAINT forzar_fallo CHECK (name <> \'documents.index\') NOT VALID');
    try {
      const response = await upload(t, { content: 'contenido con fallo', name: 'a.txt' });
      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    } finally {
      await t.pool.query('ALTER TABLE pgboss.job DROP CONSTRAINT forzar_fallo');
    }

    const count = await t.pool.query('SELECT count(*)::int AS total FROM documents');
    expect(count.rows[0].total).toBe(0);
    expect(t.storedFiles()).toEqual([]);
  });
});
