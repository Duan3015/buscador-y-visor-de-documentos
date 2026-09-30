import type { DocumentAccepted } from '@kata/shared';
import { ApiError } from '../../shared/api/client';
import { MAX_CONCURRENT_UPLOADS, UploadQueue, type UploadRequest } from './upload-queue';

const metadata = { title: 'T', author: 'A', category: 'C', tags: [] };

function request(name: string): UploadRequest {
  return { file: new File(['x'], name), metadata: { ...metadata, title: name } };
}

interface Deferred {
  name: string;
  resolve(id: string): void;
  reject(error: unknown): void;
}

/** Envio controlado por la prueba: cada llamada queda pendiente hasta resolverla. */
function controlledSender() {
  const pending: Deferred[] = [];
  const send = jest.fn(
    (req: UploadRequest) =>
      new Promise<DocumentAccepted>((resolve, reject) => {
        pending.push({
          name: req.file.name,
          resolve: (id) => resolve({ id, status: 'PROCESANDO' }),
          reject,
        });
      }),
  );
  return { send, pending };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('UploadQueue', () => {
  it('envia como maximo tres archivos a la vez y arranca el siguiente al terminar uno', async () => {
    const { send, pending } = controlledSender();
    const queue = new UploadQueue(send);

    queue.enqueue(['a', 'b', 'c', 'd', 'e'].map((name) => request(name)));

    expect(MAX_CONCURRENT_UPLOADS).toBe(3);
    expect(send).toHaveBeenCalledTimes(3);
    expect(queue.getSnapshot().map((item) => item.state)).toEqual(['ENVIANDO', 'ENVIANDO', 'ENVIANDO', 'EN_COLA', 'EN_COLA']);

    pending[0]?.resolve('id-a');
    await flush();

    expect(send).toHaveBeenCalledTimes(4);
    expect(queue.getSnapshot().map((item) => item.state)).toEqual(['ACEPTADO', 'ENVIANDO', 'ENVIANDO', 'ENVIANDO', 'EN_COLA']);
  });

  it('nunca supera la concurrencia aunque los envios terminen desordenados', async () => {
    let active = 0;
    let peak = 0;
    const send = jest.fn(async (req: UploadRequest): Promise<DocumentAccepted> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, req.file.name.length % 3));
      active -= 1;
      return { id: req.file.name, status: 'PROCESANDO' };
    });
    const queue = new UploadQueue(send);

    queue.enqueue(Array.from({ length: 12 }, (_, n) => request(`archivo-${'x'.repeat(n)}`)));
    while (queue.isBusy()) await flush();

    expect(peak).toBeLessThanOrEqual(3);
    expect(queue.getSnapshot().every((item) => item.state === 'ACEPTADO')).toBe(true);
  });

  it('guarda el identificador del servidor y avisa para seguir el documento (HU-01)', async () => {
    const { send, pending } = controlledSender();
    const onAccepted = jest.fn();
    const queue = new UploadQueue(send, onAccepted);
    queue.enqueue([request('a')]);

    pending[0]?.resolve('id-a');
    await flush();

    expect(onAccepted).toHaveBeenCalledWith('id-a');
    expect(queue.getSnapshot()[0]).toMatchObject({ state: 'ACEPTADO', documentId: 'id-a' });
  });

  it('un rechazo no detiene a los demas y conserva codigo y mensaje (E-07)', async () => {
    const { send, pending } = controlledSender();
    const queue = new UploadQueue(send);
    queue.enqueue([request('bueno'), request('malo')]);

    pending[1]?.reject(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'detalle'));
    pending[0]?.resolve('id-bueno');
    await flush();

    const [good, bad] = queue.getSnapshot();
    expect(good).toMatchObject({ state: 'ACEPTADO', documentId: 'id-bueno' });
    expect(bad).toMatchObject({ state: 'RECHAZADO', errorCode: 'UNSUPPORTED_MEDIA_TYPE' });
    expect(bad?.message).toContain('formato admitido');
  });

  it('en un 409 conserva el documento existente para enlazarlo', async () => {
    const existing = { id: '3f2b8c1e-7d44-4b0e-9a55-1c2d3e4f5a6b', status: 'INDEXADO' as const };
    const problem = { status: 409, title: 'Conflicto', detail: 'dup', code: 'DUPLICATE_DOCUMENT', traceId: 't-12345678', existing };
    const send = jest.fn().mockRejectedValue(new ApiError(409, 'DUPLICATE_DOCUMENT', 'dup', problem));
    const queue = new UploadQueue(send);

    queue.enqueue([request('repetido')]);
    await flush();

    expect(queue.getSnapshot()[0]).toMatchObject({ state: 'RECHAZADO', errorCode: 'DUPLICATE_DOCUMENT', existing });
  });

  it('trata un error inesperado como UNKNOWN_ERROR', async () => {
    const queue = new UploadQueue(jest.fn().mockRejectedValue(new Error('boom')));

    queue.enqueue([request('a')]);
    await flush();

    expect(queue.getSnapshot()[0]).toMatchObject({ state: 'RECHAZADO', errorCode: 'UNKNOWN_ERROR' });
  });

  it('un fallo al iniciar el seguimiento no convierte el envio en rechazo', async () => {
    const send = jest.fn().mockResolvedValue({ id: 'id-a', status: 'PROCESANDO' });
    const queue = new UploadQueue(send, () => {
      throw new Error('seguimiento roto');
    });

    queue.enqueue([request('a')]);
    await flush();

    expect(queue.getSnapshot()[0]).toMatchObject({ state: 'ACEPTADO', documentId: 'id-a' });
  });

  it('isBusy refleja envios pendientes y clearFinished conserva los que siguen en curso', async () => {
    const { send, pending } = controlledSender();
    const queue = new UploadQueue(send, undefined, 1);
    expect(queue.isBusy()).toBe(false);

    queue.enqueue([request('a'), request('b')]);
    expect(queue.isBusy()).toBe(true);
    pending[0]?.resolve('id-a');
    await flush();
    queue.clearFinished();

    expect(queue.getSnapshot().map((item) => item.file.name)).toEqual(['b']);
    pending[1]?.resolve('id-b');
    await flush();
    expect(queue.isBusy()).toBe(false);
  });

  it('notifica a los suscriptores en cada cambio y publica arreglos nuevos', async () => {
    const { send, pending } = controlledSender();
    const queue = new UploadQueue(send);
    const listener = jest.fn();
    queue.subscribe(listener);
    const before = queue.getSnapshot();

    queue.enqueue([request('a')]);
    pending[0]?.resolve('id-a');
    await flush();

    expect(queue.getSnapshot()).not.toBe(before);
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('ignora una lista vacia', () => {
    const send = jest.fn();
    const queue = new UploadQueue(send);

    queue.enqueue([]);

    expect(send).not.toHaveBeenCalled();
    expect(queue.getSnapshot()).toEqual([]);
  });
});
