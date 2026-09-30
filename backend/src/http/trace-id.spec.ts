import { resolveTraceId, traceIdMiddleware, type TracedRequest } from './trace-id';

describe('resolveTraceId (E-48)', () => {
  it('acepta un identificador valido del cliente', () => {
    expect(resolveTraceId('abc12345-XYZ')).toBe('abc12345-XYZ');
  });

  it.each([
    ['corto', 'abc'],
    ['con espacios', 'abc def ghi jkl'],
    ['con caracteres de control', 'abcdefgh\r\nSet-Cookie: x'],
    ['demasiado largo', 'a'.repeat(65)],
    ['vacio', ''],
  ])('descarta un identificador %s y genera uno propio', (_name, value) => {
    const result = resolveTraceId(value);
    expect(result).not.toBe(value);
    expect(result).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it('genera uno propio cuando no hay cabecera', () => {
    expect(resolveTraceId(undefined)).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it('usa el primer valor si la cabecera llega repetida', () => {
    expect(resolveTraceId(['primero-1234', 'segundo-1234'])).toBe('primero-1234');
  });
});

describe('traceIdMiddleware', () => {
  it('guarda el identificador en la solicitud y lo devuelve en la cabecera', () => {
    const headers = new Map<string, string>();
    const req = { headers: { 'x-request-id': 'cliente-12345' } } as unknown as TracedRequest;
    const res = { setHeader: (name: string, value: string) => headers.set(name, value) };
    const next = jest.fn();

    traceIdMiddleware(req, res as never, next);

    expect(req.traceId).toBe('cliente-12345');
    expect(headers.get('X-Request-Id')).toBe('cliente-12345');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
