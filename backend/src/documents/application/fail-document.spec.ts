import { Document } from '../domain/document';
import { FakeEventPublisher, FixedClock, InMemoryDocumentRepository, InMemoryUnitOfWork } from '../testing/fakes';
import { FailDocument } from './fail-document';

const DOC_ID = '00000000-0000-4000-8000-000000000001';

async function setup() {
  const repository = new InMemoryDocumentRepository();
  const events = new FakeEventPublisher();
  const unitOfWork = new InMemoryUnitOfWork([repository]);
  await unitOfWork.run((ctx) =>
    repository.insert(
      ctx,
      Document.create({
        id: DOC_ID,
        title: 'Guia',
        author: 'Ana',
        category: 'Manuales',
        tags: [],
        version: null,
        format: 'PDF',
        originalFilename: 'guia.pdf',
        sizeBytes: 10,
        fileSha256: 'b'.repeat(64),
        createdAt: new Date('2026-09-29T12:00:00Z'),
      }),
    ),
  );
  const sut = new FailDocument(repository, unitOfWork, events, new FixedClock());
  return { sut, repository, events };
}

describe('FailDocument (cola de mensajes fallidos)', () => {
  it('promueve a ERROR con la causa registrada por el ultimo intento (E-13)', async () => {
    const { sut, repository, events } = await setup();
    await repository.recordAttemptFailure(DOC_ID, {
      code: 'EXTRACTION_TIMEOUT',
      detail: 'tiempo excedido',
      at: new Date(),
    });

    await sut.execute({ documentId: DOC_ID, retryCount: 3 });

    const stored = repository.get(DOC_ID);
    expect(stored.status).toBe('ERROR');
    expect(stored.lastErrorCode).toBe('EXTRACTION_TIMEOUT');
    expect(stored.attempts).toBe(1);
    expect(events.events[0]?.event).toMatchObject({ status: 'ERROR', reason: 'EXTRACTION_TIMEOUT' });
  });

  it('usa WORKER_LOST si el trabajo caduco sin causa registrada (E-41)', async () => {
    const { sut, repository, events } = await setup();

    await sut.execute({ documentId: DOC_ID, retryCount: null });

    const stored = repository.get(DOC_ID);
    expect(stored.status).toBe('ERROR');
    expect(stored.lastErrorCode).toBe('WORKER_LOST');
    expect(stored.attempts).toBe(1);
    expect(events.events[0]?.event).toMatchObject({ status: 'ERROR', reason: 'WORKER_LOST' });
  });

  it('no cambia un documento que ya esta INDEXADO ni emite evento (E-39)', async () => {
    const { sut, repository, events } = await setup();
    repository.get(DOC_ID).status = 'INDEXADO';

    await sut.execute({ documentId: DOC_ID, retryCount: 3 });

    expect(repository.get(DOC_ID).status).toBe('INDEXADO');
    expect(events.events).toHaveLength(0);
  });

  it('es idempotente: un segundo mensaje sobre el mismo documento no emite otro evento', async () => {
    const { sut, events } = await setup();
    await sut.execute({ documentId: DOC_ID, retryCount: null });
    await sut.execute({ documentId: DOC_ID, retryCount: null });
    expect(events.events).toHaveLength(1);
  });

  it('un documento borrado se descarta sin error', async () => {
    const { sut, events } = await setup();
    await expect(
      sut.execute({ documentId: '00000000-0000-4000-8000-0000000000ff', retryCount: null }),
    ).resolves.toBeUndefined();
    expect(events.events).toHaveLength(0);
  });

  it('un fallo de la base de datos se relanza para que la cola reintente el mensaje', async () => {
    const { sut, repository } = await setup();
    repository.markFailedError = new Error('base caida');
    await expect(sut.execute({ documentId: DOC_ID, retryCount: null })).rejects.toThrow('base caida');
  });
});
