import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { buildCorruptPdf, buildPdf } from '../fixtures/pdf-builder';
import { startTestApp, waitFor, type TestApp } from './harness';

const metadata = { title: 'Guia de instalacion', author: 'Ana Perez', category: 'Manuales', version: '1.0' };

async function upload(t: TestApp, content: Buffer | string, name: string, fields: Record<string, string> = metadata) {
  const req = request(t.server).post('/api/documents');
  for (const [key, value] of Object.entries(fields)) req.field(key, value);
  const response = await req.attach('file', Buffer.from(content), name);
  expect(response.status).toBe(202);
  return response.body.id as string;
}

async function documentRow(t: TestApp, id: string) {
  const result = await t.pool.query('SELECT * FROM documents WHERE id = $1', [id]);
  return result.rows[0] as Record<string, unknown> | undefined;
}

async function waitForStatus(t: TestApp, id: string, status: string) {
  return waitFor(async () => {
    const row = await documentRow(t, id);
    return row?.status === status ? row : null;
  });
}

async function matches(t: TestApp, id: string, query: string): Promise<boolean> {
  const result = await t.pool.query(
    "SELECT 1 FROM document_contents WHERE document_id = $1 AND search_vector @@ websearch_to_tsquery('es_unaccent', $2)",
    [id, query],
  );
  return result.rowCount === 1;
}

/** Inserta un documento en PROCESANDO sin pasar por la API (para simular estados de la cola). */
async function insertProcessing(t: TestApp, format = 'TXT'): Promise<string> {
  const id = randomUUID();
  await t.pool.query(
    `INSERT INTO documents (id, title, author, category, format, original_filename, size_bytes, file_sha256, status)
     VALUES ($1, 'Huerfano', 'Ana', 'Pruebas', $2, 'x.txt', 10, $3, 'PROCESANDO')`,
    [id, format, randomUUID().replace(/-/g, '').padEnd(64, '0')],
  );
  return id;
}

describe('worker de indexacion (integracion)', () => {
  let t: TestApp;

  beforeAll(async () => {
    rmSync(process.env.STORAGE_DIR as string, { recursive: true, force: true });
    // Sin reintentos para que los fallos transitorios lleguen de inmediato a la cola de mensajes fallidos.
    t = await startTestApp({ appRole: 'all', jobRetryLimit: 0, maxIndexableChars: 600 });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await t.reset();
  });

  it('indexa un TXT, lo vuelve buscable con y sin acentos y notifica INDEXADO (HU-04)', async () => {
    const id = await upload(t, 'Guia de instalacion del servidor.\n\nConfiguracion inicial de la base de datos.', 'guia.txt');

    const row = await waitForStatus(t, id, 'INDEXADO');

    expect(row.indexed_at).toBeInstanceOf(Date);
    expect(row.last_error_code).toBeNull();
    expect(await matches(t, id, 'instalación')).toBe(true);
    expect(await matches(t, id, 'instalacion')).toBe(true);
    expect(await matches(t, id, '"configuracion inicial"')).toBe(true);
    expect(await matches(t, id, 'inexistente')).toBe(false);

    const content = await t.pool.query('SELECT * FROM document_contents WHERE document_id = $1', [id]);
    expect(content.rows[0]).toMatchObject({ is_partially_indexed: false });

    await waitFor(() => t.events.length > 0);
    expect(t.events).toEqual([{ documentId: id, status: 'INDEXADO', occurredAt: expect.any(String) }]);
  });

  it('el titulo y los metadatos tambien son buscables (HU-02)', async () => {
    const id = await upload(t, 'contenido sin relacion', 'a.txt', { ...metadata, title: 'Manual Kubernetes', author: 'Beatriz Lopez' });
    await waitForStatus(t, id, 'INDEXADO');
    expect(await matches(t, id, 'kubernetes')).toBe(true);
    expect(await matches(t, id, 'beatriz')).toBe(true);
    expect(await matches(t, id, 'manuales')).toBe(true);
  });

  it('indexa un PDF con texto', async () => {
    const id = await upload(t, buildPdf({ pages: ['Procedimiento de respaldo', 'Restauracion de datos'] }), 'respaldo.pdf');
    await waitForStatus(t, id, 'INDEXADO');
    expect(await matches(t, id, 'respaldo')).toBe(true);
    expect(await matches(t, id, 'restauracion')).toBe(true);
  });

  it('indexa un Markdown', async () => {
    const id = await upload(t, '# Titulo\n\nUn parrafo sobre **despliegue**.', 'notas.md');
    await waitForStatus(t, id, 'INDEXADO');
    expect(await matches(t, id, 'despliegue')).toBe(true);
  });

  it('indexa solo el prefijo de un texto grande y conserva el completo (E-40)', async () => {
    const text = `inicio ${'relleno '.repeat(400)} finalunico`;
    const id = await upload(t, text, 'grande.txt');
    await waitForStatus(t, id, 'INDEXADO');

    const content = await t.pool.query('SELECT * FROM document_contents WHERE document_id = $1', [id]);
    expect(content.rows[0].is_partially_indexed).toBe(true);
    expect(content.rows[0].indexed_chars).toBeLessThanOrEqual(600);
    expect(content.rows[0].total_chars).toBe(text.length);
    expect(content.rows[0].content).toBe(text);
    expect(await matches(t, id, 'inicio')).toBe(true);
    expect(await matches(t, id, 'finalunico')).toBe(false);
  });

  it.each([
    ['PDF sin capa de texto', () => buildPdf({ pages: [null] }), 'escaneado.pdf', 'NO_EXTRACTABLE_TEXT'],
    ['PDF cifrado', () => buildPdf({ pages: ['secreto'], encrypted: true }), 'cifrado.pdf', 'PDF_ENCRYPTED'],
    ['PDF danado', () => buildCorruptPdf(), 'roto.pdf', 'PDF_CORRUPT'],
    ['texto que no es UTF-8', () => Buffer.from([0x49, 0x6e, 0x73, 0xf3, 0x6e]), 'latin.txt', 'ENCODING_UNSUPPORTED'],
  ])('%s termina en ERROR con su causa y sin contenido (E-08, E-09, E-10)', async (_name, build, filename, code) => {
    const id = await upload(t, build(), filename);

    const row = await waitForStatus(t, id, 'ERROR');

    expect(row.last_error_code).toBe(code);
    expect(row.attempts).toBe(1);
    const content = await t.pool.query('SELECT 1 FROM document_contents WHERE document_id = $1', [id]);
    expect(content.rowCount).toBe(0);

    await waitFor(() => t.events.length > 0);
    expect(t.events).toEqual([{ documentId: id, status: 'ERROR', reason: code, occurredAt: expect.any(String) }]);
  });

  it('un trabajo repetido de un documento ya indexado no lo cambia ni notifica (E-14)', async () => {
    const id = await upload(t, 'contenido estable', 'a.txt');
    await waitForStatus(t, id, 'INDEXADO');
    await waitFor(() => t.events.length === 1);

    await t.sendJob('documents.index', { documentId: id });
    // El segundo trabajo se consume y se completa sin efectos.
    await waitFor(async () => (await t.countJobs('documents.index', 'completed')) === 2);

    expect((await documentRow(t, id))?.status).toBe('INDEXADO');
    expect(t.events).toHaveLength(1);
  });

  it('un trabajo cuyo archivo no existe falla, agota la cola y termina en ERROR PROCESSING_FAILED (E-13)', async () => {
    const id = await insertProcessing(t);
    await t.sendJob('documents.index', { documentId: id });

    const row = await waitForStatus(t, id, 'ERROR');

    expect(row.last_error_code).toBe('PROCESSING_FAILED');
    expect(row.attempts).toBe(1);
    await waitFor(() => t.events.length > 0);
    expect(t.events[0]).toMatchObject({ documentId: id, status: 'ERROR', reason: 'PROCESSING_FAILED' });
  });

  it('un mensaje en la cola de mensajes fallidos sin causa registrada promueve a ERROR WORKER_LOST (E-41)', async () => {
    const id = await insertProcessing(t);
    await t.sendJob('documents.index.dlq', { documentId: id });

    const row = await waitForStatus(t, id, 'ERROR');

    expect(row.last_error_code).toBe('WORKER_LOST');
    await waitFor(() => t.events.length > 0);
    expect(t.events[0]).toMatchObject({ documentId: id, status: 'ERROR', reason: 'WORKER_LOST' });
  });

  it('un mensaje fallido de un documento ya indexado no lo degrada (E-39)', async () => {
    const id = await upload(t, 'contenido correcto', 'a.txt');
    await waitForStatus(t, id, 'INDEXADO');
    await waitFor(() => t.events.length === 1);

    await t.sendJob('documents.index.dlq', { documentId: id });
    await waitFor(async () => (await t.countJobs('documents.index.dlq', 'completed')) === 1);

    expect((await documentRow(t, id))?.status).toBe('INDEXADO');
    expect(t.events).toHaveLength(1);
  });

  it('varias cargas concurrentes terminan todas INDEXADO sin perder ninguna (E-12)', async () => {
    const ids = await Promise.all(
      Array.from({ length: 8 }, (_, index) => upload(t, `documento numero ${index} con palabra comun`, `doc${index}.txt`, { ...metadata, title: `Doc ${index}` })),
    );

    await Promise.all(ids.map((id) => waitForStatus(t, id, 'INDEXADO')));

    await waitFor(() => t.events.length === 8);
    expect(new Set(t.events.map((event) => event.documentId)).size).toBe(8);
  });

  it('los archivos originales se conservan tras indexar (ADR-10)', async () => {
    const id = await upload(t, 'contenido a conservar', 'a.txt');
    await waitForStatus(t, id, 'INDEXADO');
    expect(t.storedFiles()).toEqual([id]);
    writeFileSync(join(t.config.storageDir, 'files', '.keep-test'), '');
  });
});
