import { get, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import {
  DOCUMENT_STATUS_EVENT,
  HIGHLIGHT_START,
  documentDetailSchema,
  documentStatusEventSchema,
  documentStatusListSchema,
  parseHighlight,
  problemDetailsSchema,
  searchResponseSchema,
} from '@kata/shared';
import request from 'supertest';
import { SEARCH_REPOSITORY } from '../../src/search/domain/ports';
import type { PostgresSearchRepository } from '../../src/search/infrastructure/postgres-search-repository';
import { buildCorruptPdf } from '../fixtures/pdf-builder';
import { startTestApp, waitFor, type TestApp } from './harness';

/** Ventana de resaltado reducida para probar el tope sin generar textos enormes. */
const HIGHLIGHT_WINDOW = 2_000;

const base = { author: 'Ana Perez', category: 'Manuales' };

interface SeedInput {
  title: string;
  content: string;
  author?: string;
  category?: string;
  tags?: string[];
  version?: string;
}

async function upload(t: TestApp, content: Buffer | string, name: string, fields: Record<string, string | string[]>) {
  const req = request(t.server).post('/api/documents');
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) req.field(key, item);
  }
  const response = await req.attach('file', Buffer.from(content), name);
  expect(response.status).toBe(202);
  return response.body.id as string;
}

async function statusOf(t: TestApp, id: string): Promise<string | undefined> {
  const result = await t.pool.query<{ status: string }>('SELECT status FROM documents WHERE id = $1', [id]);
  return result.rows[0]?.status;
}

async function seed(t: TestApp, input: SeedInput): Promise<string> {
  const id = await upload(t, input.content, `${randomUUID()}.txt`, {
    title: input.title,
    author: input.author ?? base.author,
    category: input.category ?? base.category,
    ...(input.tags ? { tags: input.tags } : {}),
    ...(input.version ? { version: input.version } : {}),
  });
  await waitFor(async () => (await statusOf(t, id)) === 'INDEXADO');
  return id;
}

async function search(t: TestApp, query: Record<string, string>) {
  return request(t.server).get('/api/search').query(query);
}

function expectProblem(body: unknown, code: string) {
  const problem = problemDetailsSchema.parse(body);
  expect(problem.code).toBe(code);
  return problem;
}

interface SseConnection {
  status: number;
  headers: IncomingHttpHeaders;
  /** Texto completo recibido hasta el momento. */
  received(): string;
  close(): void;
}

function openSse(baseUrl: string): Promise<SseConnection> {
  return new Promise((resolve, reject) => {
    const req = get(`${baseUrl}/api/events`, { headers: { Accept: 'text/event-stream' } }, (res: IncomingMessage) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        text += chunk;
      });
      res.on('error', () => undefined);
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        received: () => text,
        close: () => req.destroy(),
      });
    });
    req.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
    });
  });
}

function statusEvents(connection: SseConnection) {
  return connection
    .received()
    .split('\n\n')
    .filter((frame) => frame.startsWith(`event: ${DOCUMENT_STATUS_EVENT}\n`))
    .map((frame) => documentStatusEventSchema.parse(JSON.parse(frame.split('\ndata: ')[1] as string)));
}

describe('lectura y tiempo real (integracion)', () => {
  let t: TestApp;

  beforeAll(async () => {
    rmSync(process.env.STORAGE_DIR as string, { recursive: true, force: true });
    t = await startTestApp({ appRole: 'all', jobRetryLimit: 0, maxHighlightChars: HIGHLIGHT_WINDOW });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await t.reset();
  });

  describe('GET /api/search', () => {
    it('encuentra por contenido sin distinguir acentos ni mayusculas y resalta la coincidencia (HU-02)', async () => {
      const id = await seed(t, {
        title: 'Guia de despliegue',
        content: 'Pasos para la instalacion del servidor en produccion.',
      });
      await seed(t, { title: 'Otro documento', content: 'Contenido sin relacion alguna.' });

      for (const q of ['instalacion', 'INSTALACION', 'instalación']) {
        const response = await search(t, { q });
        expect(response.status).toBe(200);
        const body = searchResponseSchema.parse(response.body);
        expect(body.items.map((item) => item.id)).toEqual([id]);
        expect(body).toMatchObject({ page: 1, total: 1, totalPages: 1 });

        const fragments = body.items[0]?.fragments ?? [];
        expect(fragments.length).toBeGreaterThan(0);
        const highlighted = fragments.flatMap((fragment) => parseHighlight(fragment)).filter((segment) => segment.match);
        expect(highlighted.map((segment) => segment.text.toLowerCase())).toContain('instalacion');
      }
    });

    it('busca en titulo, autor, categoria, etiquetas y version (HU-02)', async () => {
      const id = await seed(t, {
        title: 'Manual Kubernetes',
        content: 'Texto neutro.',
        author: 'Beatriz Lopez',
        category: 'Infraestructura',
        tags: ['orquestacion', 'contenedores'],
        version: '2.4.1',
      });

      for (const q of ['kubernetes', 'beatriz', 'infraestructura', 'orquestacion', 'contenedores']) {
        const body = searchResponseSchema.parse((await search(t, { q })).body);
        expect(body.items.map((item) => item.id)).toEqual([id]);
      }
      const hit = searchResponseSchema.parse((await search(t, { q: 'kubernetes' })).body).items[0];
      expect(hit).toMatchObject({
        title: 'Manual Kubernetes',
        author: 'Beatriz Lopez',
        category: 'Infraestructura',
        tags: ['orquestacion', 'contenedores'],
        version: '2.4.1',
      });
    });

    it('respeta el orden de las palabras en frases entre comillas', async () => {
      const id = await seed(t, { title: 'Operacion', content: 'El despliegue automatizado usa contenedores.' });

      const exact = searchResponseSchema.parse((await search(t, { q: '"despliegue automatizado"' })).body);
      expect(exact.items.map((item) => item.id)).toEqual([id]);

      const reversed = searchResponseSchema.parse((await search(t, { q: '"automatizado despliegue"' })).body);
      expect(reversed.total).toBe(0);
    });

    it('prioriza la coincidencia en el titulo sobre la del contenido', async () => {
      const contentOnly = await seed(t, { title: 'Notas varias', content: 'Se menciona kubernetes una sola vez.' });
      const inTitle = await seed(t, { title: 'Kubernetes', content: 'Otro tema distinto por completo.' });

      const body = searchResponseSchema.parse((await search(t, { q: 'kubernetes' })).body);
      expect(body.items.map((item) => item.id)).toEqual([inTitle, contentOnly]);
    });

    it('usa el indice GIN para filtrar y no recorre la tabla completa (ADR-03, benchmark de la API)', async () => {
      await seed(t, { title: 'Guia', content: 'Pasos para la instalacion del servidor.' });
      const repository = t.app.get<PostgresSearchRepository>(SEARCH_REPOSITORY);

      const plan = await repository.explain('instalacion', 0, 10);

      expect(plan).toContain('document_contents_search_vector_idx');
      expect(plan).not.toMatch(/Seq Scan on document_contents/);
    });

    it('resalta solo dentro de la ventana inicial pero sigue encontrando coincidencias posteriores', async () => {
      const filler = 'relleno neutro sin interes '.repeat(Math.ceil((HIGHLIGHT_WINDOW * 2) / 27));
      const early = await seed(t, { title: 'Temprano', content: `El zafiro aparece al inicio. ${filler}` });
      const late = await seed(t, { title: 'Tardio', content: `${filler} y solo al final el zafiro.` });

      const body = searchResponseSchema.parse((await search(t, { q: 'zafiro' })).body);

      expect(body.total).toBe(2);
      const byId = new Map(body.items.map((item) => [item.id, item]));
      expect(byId.get(early)?.fragments.length).toBeGreaterThan(0);
      expect(byId.get(late)).toBeDefined();
      expect(byId.get(late)?.fragments).toEqual([]);
    });

    it('pagina con total exacto y devuelve una pagina vacia fuera de rango (E-19)', async () => {
      for (let n = 1; n <= 12; n++) {
        await seed(t, { title: `Reporte ${n}`, content: `Informe trimestral de ventas numero ${n}.` });
      }

      const first = searchResponseSchema.parse((await search(t, { q: 'informe' })).body);
      expect(first).toMatchObject({ page: 1, total: 12, totalPages: 2 });
      expect(first.items).toHaveLength(10);

      const second = searchResponseSchema.parse((await search(t, { q: 'informe', page: '2' })).body);
      expect(second).toMatchObject({ page: 2, total: 12, totalPages: 2 });
      expect(second.items).toHaveLength(2);

      const beyond = searchResponseSchema.parse((await search(t, { q: 'informe', page: '3' })).body);
      expect(beyond).toMatchObject({ page: 3, total: 12, totalPages: 2, items: [] });

      const ids = new Set([...first.items, ...second.items].map((item) => item.id));
      expect(ids.size).toBe(12);
    });

    it('solo devuelve documentos INDEXADO (los que fallaron no aparecen)', async () => {
      const failed = await upload(t, buildCorruptPdf(), 'roto.pdf', { title: 'Escaneado unico', ...base });
      await waitFor(async () => (await statusOf(t, failed)) === 'ERROR');
      await seed(t, { title: 'Otro', content: 'texto cualquiera' });

      const body = searchResponseSchema.parse((await search(t, { q: 'escaneado' })).body);
      expect(body.total).toBe(0);
    });

    it('responde 200 sin resultados cuando la consulta solo tiene palabras vacias (E-21)', async () => {
      await seed(t, { title: 'Documento', content: 'texto cualquiera' });

      const response = await search(t, { q: 'de la' });

      expect(response.status).toBe(200);
      expect(searchResponseSchema.parse(response.body)).toMatchObject({ total: 0, items: [], totalPages: 0 });
    });

    it.each([
      ['consulta ausente', {}],
      ['consulta vacia', { q: '' }],
      ['consulta con espacios', { q: '   ' }],
      ['consulta demasiado larga', { q: 'x'.repeat(201) }],
      ['pagina cero', { q: 'a', page: '0' }],
      ['pagina no numerica', { q: 'a', page: 'abc' }],
      ['pagina por encima del maximo', { q: 'a', page: '51' }],
      ['parametro de tamano de pagina', { q: 'a', pageSize: '5' }],
      ['caracter nulo', { q: 'abc\u0000def' }],
    ])('rechaza con 400 INVALID_QUERY: %s', async (_name, query) => {
      const response = await search(t, query as Record<string, string>);

      expect(response.status).toBe(400);
      expectProblem(response.body, 'INVALID_QUERY');
    });

    it.each([
      ["'; DROP TABLE documents; --"],
      ['!!!'],
      ['& | ! ( ) :* <->'],
      ['"comilla sin cerrar'],
      ['-'],
      ['\\'],
      ['%_'],
      ['{"$ne": null}'],
    ])('tolera una consulta hostil sin error de servidor: %s', async (q) => {
      await seed(t, { title: 'Documento', content: 'texto cualquiera' });

      const response = await search(t, { q });

      expect(response.status).toBe(200);
      searchResponseSchema.parse(response.body);
      const table = await t.pool.query("SELECT to_regclass('public.documents') AS name");
      expect(table.rows[0]?.name).toBe('documents');
    });

    it('no devuelve el caracter de resaltado dentro del texto original', async () => {
      await seed(t, { title: 'Marcadores', content: `Texto con ${HIGHLIGHT_START} incrustado y palabra objetivo.` });

      const body = searchResponseSchema.parse((await search(t, { q: 'objetivo' })).body);

      for (const fragment of body.items[0]?.fragments ?? []) {
        const segments = parseHighlight(fragment);
        expect(segments.every((segment) => !segment.text.includes(HIGHLIGHT_START))).toBe(true);
      }
    });
  });

  describe('GET /api/documents/:id', () => {
    it('devuelve contenido y metadatos de un documento INDEXADO (HU-03)', async () => {
      const id = await seed(t, {
        title: 'Guia',
        content: 'Primer parrafo.\n\nSegundo parrafo con acentos: canción.',
        tags: ['uno', 'dos'],
        version: '1.0',
      });

      const response = await request(t.server).get(`/api/documents/${id}`);

      expect(response.status).toBe(200);
      const body = documentDetailSchema.parse(response.body);
      expect(body).toMatchObject({
        id,
        title: 'Guia',
        author: base.author,
        category: base.category,
        tags: ['uno', 'dos'],
        version: '1.0',
        format: 'TXT',
        status: 'INDEXADO',
        error: null,
        isPartiallyIndexed: false,
      });
      expect(body.content).toContain('Segundo parrafo con acentos: canción.');
      expect(body.totalChars).toBe(body.indexedChars);
      expect(body.indexedAt).not.toBeNull();
    });

    it('comprime el detalle de documentos grandes', async () => {
      const id = await seed(t, { title: 'Extenso', content: 'palabra repetida. '.repeat(500) });

      const response = await request(t.server).get(`/api/documents/${id}`).set('Accept-Encoding', 'gzip');

      expect(response.status).toBe(200);
      expect(response.headers['content-encoding']).toBe('gzip');
      expect(documentDetailSchema.parse(response.body).content).toContain('palabra repetida.');
    });

    it('informa el estado PROCESANDO sin contenido', async () => {
      const id = randomUUID();
      await t.pool.query(
        `INSERT INTO documents (id, title, author, category, format, original_filename, size_bytes, file_sha256, status)
         VALUES ($1, 'En cola', 'Ana', 'Pruebas', 'TXT', 'x.txt', 10, $2, 'PROCESANDO')`,
        [id, randomUUID().replace(/-/g, '').padEnd(64, '0')],
      );

      const response = await request(t.server).get(`/api/documents/${id}`);

      expect(response.status).toBe(200);
      expect(documentDetailSchema.parse(response.body)).toMatchObject({
        status: 'PROCESANDO',
        content: null,
        error: null,
        isPartiallyIndexed: null,
      });
    });

    it('informa la causa de un documento en ERROR sin contenido', async () => {
      const id = await upload(t, buildCorruptPdf(), 'roto.pdf', { title: 'Roto', ...base });
      await waitFor(async () => (await statusOf(t, id)) === 'ERROR');

      const response = await request(t.server).get(`/api/documents/${id}`);

      expect(response.status).toBe(200);
      expect(documentDetailSchema.parse(response.body)).toMatchObject({
        status: 'ERROR',
        content: null,
        error: { code: 'PDF_CORRUPT' },
      });
    });

    it.each([[randomUUID()], ['no-es-un-uuid'], ['1'], ["'; DROP TABLE documents; --"]])(
      'responde 404 DOCUMENT_NOT_FOUND para el identificador %s',
      async (id) => {
        const response = await request(t.server).get(`/api/documents/${encodeURIComponent(id)}`);

        expect(response.status).toBe(404);
        expectProblem(response.body, 'DOCUMENT_NOT_FOUND');
      },
    );
  });

  describe('GET /api/documents?ids=', () => {
    it('devuelve el estado de los documentos conocidos y omite los desconocidos', async () => {
      const indexed = await seed(t, { title: 'Uno', content: 'texto uno' });
      const failed = await upload(t, buildCorruptPdf(), 'roto.pdf', { title: 'Dos', ...base });
      await waitFor(async () => (await statusOf(t, failed)) === 'ERROR');

      const response = await request(t.server).get('/api/documents').query({ ids: `${indexed},${failed},${randomUUID()}` });

      expect(response.status).toBe(200);
      const body = documentStatusListSchema.parse(response.body);
      expect(body.items).toHaveLength(2);
      expect(body.items).toEqual(
        expect.arrayContaining([
          { id: indexed, status: 'INDEXADO', errorCode: null },
          { id: failed, status: 'ERROR', errorCode: 'PDF_CORRUPT' },
        ]),
      );
    });

    it.each([
      ['ids ausente', {}],
      ['ids vacio', { ids: '' }],
      ['identificador invalido', { ids: 'abc' }],
      ['identificador invalido mezclado', { ids: `${randomUUID()},abc` }],
      ['demasiados identificadores', { ids: Array.from({ length: 51 }, () => randomUUID()).join(',') }],
    ])('rechaza con 400 INVALID_QUERY: %s', async (_name, query) => {
      const response = await request(t.server).get('/api/documents').query(query);

      expect(response.status).toBe(400);
      expectProblem(response.body, 'INVALID_QUERY');
    });
  });

  describe('GET /api/events (SSE)', () => {
    it('abre el flujo sin compresion ni cache y anuncia el intervalo de reconexion', async () => {
      const connection = await openSse(t.baseUrl);
      try {
        expect(connection.status).toBe(200);
        expect(connection.headers['content-type']).toContain('text/event-stream');
        expect(connection.headers['content-encoding']).toBeUndefined();
        expect(connection.headers['cache-control']).toContain('no-cache');
        await waitFor(() => connection.received().includes('retry: 3000'));
      } finally {
        connection.close();
      }
    });

    it('notifica INDEXADO sin consultas repetidas del cliente (HU-04)', async () => {
      const connection = await openSse(t.baseUrl);
      try {
        const id = await upload(t, 'Contenido para notificar.', 'n.txt', { title: 'Notificar', ...base });

        const event = await waitFor(() => statusEvents(connection).find((item) => item.documentId === id));

        expect(event.status).toBe('INDEXADO');
      } finally {
        connection.close();
      }
    });

    it('notifica ERROR con el estado final del documento', async () => {
      const connection = await openSse(t.baseUrl);
      try {
        const id = await upload(t, buildCorruptPdf(), 'roto.pdf', { title: 'Roto', ...base });

        const event = await waitFor(() => statusEvents(connection).find((item) => item.documentId === id));

        expect(event.status).toBe('ERROR');
      } finally {
        connection.close();
      }
    });

    it('entrega el mismo evento a todas las pestanas conectadas', async () => {
      const first = await openSse(t.baseUrl);
      const second = await openSse(t.baseUrl);
      try {
        const id = await upload(t, 'Contenido para dos pestanas.', 'd.txt', { title: 'Dos pestanas', ...base });

        await waitFor(() => statusEvents(first).some((item) => item.documentId === id));
        await waitFor(() => statusEvents(second).some((item) => item.documentId === id));
      } finally {
        first.close();
        second.close();
      }
    });

    it('rechaza con 503 y Retry-After al superar el maximo de conexiones y libera cupo al desconectar', async () => {
      const limited = await startTestApp({ appRole: 'api', maxSseClients: 1 });
      try {
        const first = await openSse(limited.baseUrl);
        expect(first.status).toBe(200);

        const rejected = await request(limited.server).get('/api/events');
        expect(rejected.status).toBe(503);
        expect(rejected.headers['retry-after']).toBe('5');
        expectProblem(rejected.body, 'TOO_MANY_CONNECTIONS');

        first.close();
        const reopened = await waitFor(async () => {
          const attempt = await openSse(limited.baseUrl);
          if (attempt.status === 200) return attempt;
          attempt.close();
          return null;
        });
        reopened.close();
      } finally {
        await limited.close();
      }
    });
  });
});
