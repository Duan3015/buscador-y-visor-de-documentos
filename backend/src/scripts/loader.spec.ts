import type { GeneratedDocument } from './corpus';
import { uploadAll, waitUntilSettled, type FetchLike } from './loader';

const doc = (n: number): GeneratedDocument => ({
  title: `Documento ${n}`,
  author: 'Ana',
  category: 'Manuales',
  tags: ['uno', 'dos'],
  version: '1.0',
  filename: `doc-${n}.txt`,
  format: 'TXT',
  content: `contenido ${n}`,
});

const respond = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

describe('uploadAll', () => {
  it('envia cada documento como multipart y devuelve los identificadores', async () => {
    const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>((_url, init) => {
      const title = (init?.body as FormData).get('title');
      return respond(202, { id: `id-${title}` });
    });

    const outcomes = await uploadAll([doc(1), doc(2)], { apiUrl: 'http://api/api', fetchImpl });

    expect(outcomes.map((outcome) => outcome.id)).toEqual(['id-Documento 1', 'id-Documento 2']);
    const [url, init] = fetchImpl.mock.calls[0] as Parameters<FetchLike>;
    expect(url).toBe('http://api/api/documents');
    expect(init?.method).toBe('POST');
    const form = init?.body as FormData;
    expect(form.getAll('tags')).toEqual(['uno', 'dos']);
    expect((form.get('file') as File).name).toBe('doc-1.txt');
  });

  it('respeta la concurrencia maxima y conserva el orden del resultado', async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl: FetchLike = async (_url, init) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ok: true, status: 202, json: () => Promise.resolve({ id: String((init?.body as FormData).get('title')) }) };
    };
    const progress: number[] = [];

    const outcomes = await uploadAll(Array.from({ length: 12 }, (_, n) => doc(n)), {
      apiUrl: 'http://api/api',
      fetchImpl,
      concurrency: 3,
      onProgress: (done) => progress.push(done),
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(outcomes.map((outcome) => outcome.id)).toEqual(Array.from({ length: 12 }, (_, n) => `Documento ${n}`));
    expect(progress).toEqual(Array.from({ length: 12 }, (_, n) => n + 1));
  });

  it('reintenta un 503 y termina aceptando el documento', async () => {
    const fetchImpl = jest
      .fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
      .mockImplementationOnce(() => respond(503, { code: 'SERVICE_UNAVAILABLE' }))
      .mockImplementationOnce(() => respond(202, { id: 'ok' }));

    const [outcome] = await uploadAll([doc(1)], { apiUrl: 'http://api/api', fetchImpl });

    expect(outcome).toMatchObject({ status: 202, id: 'ok' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('no reintenta un error definitivo y conserva su codigo', async () => {
    const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(() => respond(409, { code: 'DUPLICATE_DOCUMENT' }));

    const [outcome] = await uploadAll([doc(1)], { apiUrl: 'http://api/api', fetchImpl });

    expect(outcome).toEqual({ filename: 'doc-1.txt', status: 409, code: 'DUPLICATE_DOCUMENT' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('informa NETWORK_ERROR tras agotar los reintentos de red', async () => {
    const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(() => Promise.reject(new Error('ECONNREFUSED')));

    const [outcome] = await uploadAll([doc(1)], { apiUrl: 'http://api/api', fetchImpl });

    expect(outcome).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  }, 15_000);
});

describe('waitUntilSettled', () => {
  it('consulta por lotes de 50 hasta que no queda ninguno en PROCESANDO', async () => {
    const ids = Array.from({ length: 120 }, (_, n) => `id-${n}`);
    const calls: number[] = [];
    let round = 0;
    const fetchImpl: FetchLike = (url) => {
      const requested = new URL(url).searchParams.get('ids')!.split(',');
      calls.push(requested.length);
      if (requested.length === 120) throw new Error('lote demasiado grande');
      const items = requested.map((id) => ({ id, status: round === 0 && id === 'id-7' ? 'PROCESANDO' : id === 'id-9' ? 'ERROR' : 'INDEXADO' }));
      if (requested.includes('id-7')) round += 1;
      return respond(200, { items });
    };

    const counts = await waitUntilSettled(ids, { apiUrl: 'http://api/api', fetchImpl, intervalMs: 1 });

    expect(counts).toEqual({ indexed: 119, error: 1, pending: 0 });
    expect(calls.slice(0, 3)).toEqual([50, 50, 20]);
    expect(Math.max(...calls)).toBeLessThanOrEqual(50);
    expect(calls.length).toBeGreaterThan(3);
  });

  it('falla con un mensaje claro si se agota el plazo', async () => {
    const fetchImpl: FetchLike = () => respond(200, { items: [{ id: 'a', status: 'PROCESANDO' }] });

    await expect(waitUntilSettled(['a'], { apiUrl: 'http://api/api', fetchImpl, timeoutMs: 20, intervalMs: 5 })).rejects.toThrow(
      '1 documentos siguen en PROCESANDO',
    );
  });

  it('propaga un error HTTP de la consulta de estados', async () => {
    const fetchImpl: FetchLike = () => respond(500, {});

    await expect(waitUntilSettled(['a'], { apiUrl: 'http://api/api', fetchImpl })).rejects.toThrow('HTTP 500');
  });
});
