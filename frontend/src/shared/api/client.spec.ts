/** @jest-environment node */
import { ApiError, createApiClient } from './client';

const ID = '3f2b8c1e-7d44-4b0e-9a55-1c2d3e4f5a6b';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function problem(code: string, status: number, extra: object = {}) {
  return { status, title: 'Error', detail: 'detalle del servidor', code, traceId: 'trace-1234', ...extra };
}

describe('createApiClient', () => {
  it('busca con la consulta codificada y valida la respuesta', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ items: [], page: 1, total: 0, totalPages: 0 }));
    const client = createApiClient('http://api.test/api/', fetchMock);

    const result = await client.searchDocuments({ q: 'guia de instalacion & mas', page: 2 });

    expect(result.total).toBe(0);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://api.test/api/search?q=guia+de+instalacion+%26+mas&page=2');
  });

  it('expone la URL del canal de eventos', () => {
    expect(createApiClient('http://api.test/api/', jest.fn()).eventsUrl).toBe('http://api.test/api/events');
  });

  it('consulta los estados con los identificadores separados por coma', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ items: [{ id: ID, status: 'INDEXADO', errorCode: null }] }));
    const client = createApiClient('http://api.test/api', fetchMock);

    const result = await client.getStatuses([ID, ID.replace('3f', '4f')]);

    expect(result.items).toHaveLength(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(decodeURIComponent(url)).toContain(`ids=${ID},4f2b8c1e`);
  });

  it('convierte un problema del servidor en ApiError con su codigo', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(problem('DOCUMENT_NOT_FOUND', 404), 404));
    const client = createApiClient('http://api.test/api', fetchMock);

    const error = await client.getDocument(ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'DOCUMENT_NOT_FOUND', message: 'detalle del servidor' });
  });

  it('conserva el documento existente de un 409', async () => {
    const existing = { id: ID, status: 'INDEXADO' };
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(problem('DUPLICATE_DOCUMENT', 409, { existing }), 409));
    const client = createApiClient('http://api.test/api', fetchMock);
    const file = new File(['hola'], 'a.txt', { type: 'text/plain' });

    const error = (await client
      .uploadDocument({ file, metadata: { title: 'A', author: 'B', category: 'C', tags: [] } })
      .catch((e: unknown) => e)) as ApiError;

    expect(error.code).toBe('DUPLICATE_DOCUMENT');
    expect(error.problem?.existing).toEqual(existing);
  });

  it('usa UNKNOWN_ERROR cuando el error no es un problema valido', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
    const client = createApiClient('http://api.test/api', fetchMock);

    await expect(client.getDocument(ID)).rejects.toMatchObject({ status: 502, code: 'UNKNOWN_ERROR' });
  });

  it('traduce un fallo de red a NETWORK_ERROR', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const client = createApiClient('http://api.test/api', fetchMock);

    await expect(client.getDocument(ID)).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('propaga la cancelacion sin convertirla en error de red', async () => {
    const abort = new DOMException('cancelado', 'AbortError');
    const fetchMock = jest.fn().mockRejectedValue(abort);
    const client = createApiClient('http://api.test/api', fetchMock);

    await expect(client.getDocument(ID)).rejects.toBe(abort);
  });

  it('rechaza una respuesta que no cumple el contrato', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ items: 'no-es-una-lista' }));
    const client = createApiClient('http://api.test/api', fetchMock);

    await expect(client.searchDocuments({ q: 'a', page: 1 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rechaza una respuesta que no es JSON', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('texto', { status: 200 }));
    const client = createApiClient('http://api.test/api', fetchMock);

    await expect(client.searchDocuments({ q: 'a', page: 1 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('envia la carga como multipart con etiquetas repetidas y sin version vacia', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ id: ID, status: 'PROCESANDO' }, 202));
    const client = createApiClient('http://api.test/api', fetchMock);
    const file = new File(['hola'], 'guia.txt', { type: 'text/plain' });

    const accepted = await client.uploadDocument({
      file,
      metadata: { title: 'Guia', author: 'Ana', category: 'Manuales', tags: ['uno', 'dos'] },
    });

    expect(accepted).toEqual({ id: ID, status: 'PROCESANDO' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/documents');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.getAll('tags')).toEqual(['uno', 'dos']);
    expect(form.get('title')).toBe('Guia');
    expect(form.has('version')).toBe(false);
    expect((form.get('file') as File).name).toBe('guia.txt');
  });
});
