import { Document } from '../domain/document';
import { PrefixChunkingStrategy } from '../domain/prefix-chunking';
import { DocumentProcessingError, permanentFailure, transientFailure } from '../domain/processing-error';
import {
  FakeEventPublisher,
  FakeTextExtractor,
  FixedClock,
  FixedChunkingStrategy,
  InMemoryDocumentRepository,
  InMemoryFileStorage,
  InMemoryUnitOfWork,
} from '../testing/fakes';
import { MAX_PREFIX_HALVINGS, ProcessDocument, type ProcessLimits } from './process-document';

const DOC_ID = '00000000-0000-4000-8000-000000000001';
const limits: ProcessLimits = { maxPages: 10, maxChars: 3_000_000, timeoutMs: 1000, maxIndexableChars: 300_000 };

async function setup(options: { extractor?: FakeTextExtractor; chunking?: 'fixed' | 'prefix'; limits?: ProcessLimits } = {}) {
  const repository = new InMemoryDocumentRepository();
  const storage = new InMemoryFileStorage();
  const events = new FakeEventPublisher();
  const extractor = options.extractor ?? new FakeTextExtractor();
  const logs: string[] = [];
  const unitOfWork = new InMemoryUnitOfWork([repository]);

  const document = Document.create({
    id: DOC_ID,
    title: 'Guia',
    author: 'Ana',
    category: 'Manuales',
    tags: [],
    version: null,
    format: 'TXT',
    originalFilename: 'guia.txt',
    sizeBytes: 10,
    fileSha256: 'a'.repeat(64),
    createdAt: new Date('2026-09-29T12:00:00Z'),
  });
  await unitOfWork.run((ctx) => repository.insert(ctx, document));
  storage.files.set(DOC_ID, Buffer.from('texto del documento'));

  const sut = new ProcessDocument(
    repository,
    unitOfWork,
    storage,
    extractor,
    events,
    options.chunking === 'prefix' ? new PrefixChunkingStrategy() : new FixedChunkingStrategy(),
    new FixedClock(),
    options.limits ?? limits,
    { info: (m) => logs.push(`info ${m}`), warn: (m) => logs.push(`warn ${m}`), error: (m) => logs.push(`error ${m}`) },
  );
  return { sut, repository, storage, events, extractor, logs };
}

describe('ProcessDocument', () => {
  it('extrae, indexa y marca INDEXADO emitiendo un solo evento en la misma transaccion (HU-04)', async () => {
    const { sut, repository, events } = await setup();

    await sut.execute(DOC_ID);

    const stored = repository.get(DOC_ID);
    expect(stored.status).toBe('INDEXADO');
    expect(stored.content).toEqual({ content: 'texto del documento', totalChars: 19, indexedChars: 19 });
    expect(events.events).toHaveLength(1);
    expect(events.events[0]?.event).toEqual({
      documentId: DOC_ID,
      status: 'INDEXADO',
      occurredAt: '2026-09-29T12:00:00.000Z',
    });
  });

  it('pasa al extractor el formato del documento y los limites configurados', async () => {
    const { sut, extractor } = await setup();
    await sut.execute(DOC_ID);
    expect(extractor.calls).toEqual([{ format: 'TXT', limits }]);
  });

  it('indexa solo el prefijo si el texto supera el tope, conservando el texto completo (E-40)', async () => {
    const extractor = new FakeTextExtractor(() => 'palabra '.repeat(1000));
    const { sut, repository } = await setup({
      extractor,
      chunking: 'prefix',
      limits: { ...limits, maxIndexableChars: 100 },
    });

    await sut.execute(DOC_ID);

    const content = repository.get(DOC_ID).content;
    expect(content?.totalChars).toBe(8000);
    expect(content?.indexedChars).toBeLessThanOrEqual(100);
    expect(content?.content).toHaveLength(8000);
  });

  it('reduce a la mitad el prefijo si el vector supera el limite y termina INDEXADO (E-34)', async () => {
    const extractor = new FakeTextExtractor(() => 'x'.repeat(1000));
    const { sut, repository, events } = await setup({ extractor, limits: { ...limits, maxIndexableChars: 800 } });
    repository.indexLimitFailures = 2;

    await sut.execute(DOC_ID);

    expect(repository.get(DOC_ID).status).toBe('INDEXADO');
    expect(repository.savedContents.map((c) => c.indexedChars)).toEqual([200]);
    expect(events.events).toHaveLength(1);
  });

  it('pasa a ERROR con INDEX_LIMIT_EXCEEDED si persiste tras reducir el prefijo (E-34)', async () => {
    const extractor = new FakeTextExtractor(() => 'x'.repeat(1000));
    const { sut, repository, events } = await setup({ extractor });
    repository.indexLimitFailures = MAX_PREFIX_HALVINGS + 1;

    await sut.execute(DOC_ID);

    const stored = repository.get(DOC_ID);
    expect(stored.status).toBe('ERROR');
    expect(stored.lastErrorCode).toBe('INDEX_LIMIT_EXCEEDED');
    expect(events.events.map((e) => e.event)).toEqual([
      expect.objectContaining({ status: 'ERROR', reason: 'INDEX_LIMIT_EXCEEDED' }),
    ]);
  });

  it.each([
    ['NO_EXTRACTABLE_TEXT', 'E-08'],
    ['PDF_ENCRYPTED', 'E-09'],
    ['PDF_CORRUPT', 'E-09'],
    ['ENCODING_UNSUPPORTED', 'E-10'],
    ['TEXT_TOO_LARGE', 'E-36'],
    ['PDF_TOO_MANY_PAGES', 'E-35'],
  ] as const)('un fallo permanente %s marca ERROR sin reintentar (%s)', async (code, _edgeCase) => {
    const extractor = new FakeTextExtractor(() => {
      throw permanentFailure(code, `detalle ${code}`);
    });
    const { sut, repository, events } = await setup({ extractor });

    await expect(sut.execute(DOC_ID)).resolves.toBeUndefined();

    const stored = repository.get(DOC_ID);
    expect(stored.status).toBe('ERROR');
    expect(stored.lastErrorCode).toBe(code);
    expect(stored.lastErrorDetail).toBe(`detalle ${code}`);
    expect(events.events).toHaveLength(1);
    expect(events.events[0]?.event).toMatchObject({ status: 'ERROR', reason: code });
  });

  it('el evento de error y el cambio de estado comparten transaccion (ADR-08)', async () => {
    const extractor = new FakeTextExtractor(() => {
      throw permanentFailure('PDF_CORRUPT', 'ilegible');
    });
    const { sut, events } = await setup({ extractor });
    await sut.execute(DOC_ID);
    expect(events.events[0]?.ctx).toBeDefined();
  });

  it('un fallo transitorio registra el intento, deja PROCESANDO y relanza para reintentar (E-13, E-37)', async () => {
    const extractor = new FakeTextExtractor(() => {
      throw transientFailure('EXTRACTION_TIMEOUT', 'tiempo excedido');
    });
    const { sut, repository, events } = await setup({ extractor });

    await expect(sut.execute(DOC_ID)).rejects.toBeInstanceOf(DocumentProcessingError);

    const stored = repository.get(DOC_ID);
    expect(stored.status).toBe('PROCESANDO');
    expect(stored.lastErrorCode).toBe('EXTRACTION_TIMEOUT');
    expect(stored.attempts).toBe(1);
    expect(events.events).toHaveLength(0);
  });

  it('un error inesperado se trata como transitorio PROCESSING_FAILED sin exponer su mensaje (E-13)', async () => {
    const extractor = new FakeTextExtractor(() => {
      throw new Error('ENOENT: /srv/storage/secreto');
    });
    const { sut, repository } = await setup({ extractor });

    await expect(sut.execute(DOC_ID)).rejects.toThrow('ENOENT');

    const stored = repository.get(DOC_ID);
    expect(stored.lastErrorCode).toBe('PROCESSING_FAILED');
    expect(stored.lastErrorDetail).not.toContain('/srv');
  });

  it('un archivo inexistente en el almacenamiento es un fallo transitorio', async () => {
    const { sut, repository, storage } = await setup();
    storage.files.delete(DOC_ID);
    await expect(sut.execute(DOC_ID)).rejects.toThrow();
    expect(repository.get(DOC_ID).lastErrorCode).toBe('PROCESSING_FAILED');
  });

  it('un fallo de la base de datos al guardar deja PROCESANDO y relanza (E-13)', async () => {
    const { sut, repository, events } = await setup();
    repository.saveError = new Error('conexion perdida');

    await expect(sut.execute(DOC_ID)).rejects.toThrow('conexion perdida');

    expect(repository.get(DOC_ID).status).toBe('PROCESANDO');
    expect(events.events).toHaveLength(0);
  });

  it('si no se puede registrar el intento fallido, el error original se relanza igualmente', async () => {
    const extractor = new FakeTextExtractor(() => {
      throw transientFailure('EXTRACTION_TIMEOUT', 'tiempo excedido');
    });
    const { sut, repository, logs } = await setup({ extractor });
    repository.recordAttemptError = new Error('base caida');

    await expect(sut.execute(DOC_ID)).rejects.toBeInstanceOf(DocumentProcessingError);
    expect(logs.some((l) => l.includes('no se pudo registrar el intento'))).toBe(true);
  });

  it('un documento que ya no esta en PROCESANDO se ignora sin extraer ni emitir (E-14)', async () => {
    const { sut, repository, events, extractor } = await setup();
    repository.get(DOC_ID).status = 'INDEXADO';

    await sut.execute(DOC_ID);

    expect(extractor.calls).toHaveLength(0);
    expect(events.events).toHaveLength(0);
  });

  it('un documento inexistente se descarta sin error (borrado antes de procesar)', async () => {
    const { sut, logs } = await setup();
    await expect(sut.execute('00000000-0000-4000-8000-0000000000ff')).resolves.toBeUndefined();
    expect(logs.some((l) => l.startsWith('warn'))).toBe(true);
  });

  it('dos entregas simultaneas del mismo trabajo: solo una cambia el estado y notifica (E-39)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const extractor = new FakeTextExtractor(async () => {
      await gate;
      return 'texto compartido';
    });
    const { sut, repository, events } = await setup({ extractor });

    const first = sut.execute(DOC_ID);
    const second = sut.execute(DOC_ID);
    release();
    await Promise.all([first, second]);

    expect(repository.get(DOC_ID).status).toBe('INDEXADO');
    expect(repository.savedContents).toHaveLength(1);
    expect(events.events).toHaveLength(1);
  });

  it('si una entrega indexa y otra falla a la vez, gana una sola transicion y hay un solo evento (E-39)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const extractor = new FakeTextExtractor(async () => {
      calls += 1;
      await gate;
      if (calls === 2) throw permanentFailure('PDF_CORRUPT', 'ilegible');
      return 'texto';
    });
    const { sut, repository, events } = await setup({ extractor });

    const first = sut.execute(DOC_ID);
    const second = sut.execute(DOC_ID);
    release();
    await Promise.all([first, second]);

    // Cualquiera de las dos puede confirmar primero; lo que importa es que el estado final
    // coincida con el unico evento emitido.
    const status = repository.get(DOC_ID).status;
    expect(['INDEXADO', 'ERROR']).toContain(status);
    expect(events.events).toHaveLength(1);
    expect(events.events[0]?.event.status).toBe(status);
  });
});
