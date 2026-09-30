import type { UploadMetadata } from '@kata/shared';
import {
  DuplicateDocumentError,
  EmptyFileError,
  FileRequiredError,
  FileTooLargeError,
  UnsupportedMediaTypeError,
} from '../../shared-kernel/errors';
import {
  FakeJobQueue,
  FixedClock,
  InMemoryDocumentRepository,
  InMemoryFileStorage,
  InMemoryUnitOfWork,
  SequentialIdGenerator,
} from '../testing/fakes';
import { UploadDocument, type UploadedFile } from './upload-document';

const metadata: UploadMetadata = {
  title: 'Guia de instalacion',
  author: 'Ana',
  category: 'Manuales',
  tags: ['nestjs'],
  version: undefined,
};

const limits = { maxBytesText: 1000, maxBytesPdf: 5000 };

function buildSut() {
  const repository = new InMemoryDocumentRepository();
  const storage = new InMemoryFileStorage();
  const queue = new FakeJobQueue();
  const unitOfWork = new InMemoryUnitOfWork([repository]);
  const warnings: string[] = [];
  const sut = new UploadDocument(
    repository,
    unitOfWork,
    storage,
    queue,
    new FixedClock(),
    new SequentialIdGenerator(),
    limits,
    { warn: (message) => warnings.push(message) },
  );
  return { sut, repository, storage, queue, warnings };
}

function textFile(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    tempPath: 'tmp-1',
    originalName: 'guia.txt',
    sizeBytes: 100,
    sha256: 'a'.repeat(64),
    head: Buffer.from('contenido de texto'),
    ...overrides,
  };
}

describe('UploadDocument', () => {
  it('registra el documento en PROCESANDO y encola el trabajo en la misma transaccion (HU-01)', async () => {
    const { sut, repository, queue } = buildSut();

    const result = await sut.execute({ metadata, file: textFile() });

    expect(result.status).toBe('PROCESANDO');
    expect(repository.get(result.id).status).toBe('PROCESANDO');
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0]?.documentId).toBe(result.id);
    expect(queue.enqueued[0]?.ctx).toBe(repository.insertContexts[0]);
  });

  it('guarda el archivo definitivo con el identificador generado antes de la transaccion (E-43)', async () => {
    const { sut, storage } = buildSut();
    const result = await sut.execute({ metadata, file: textFile() });
    expect(storage.files.has(result.id)).toBe(true);
    expect(storage.temps.size).toBe(0);
  });

  it('persiste la version ausente como nula y sanea el nombre original (E-06)', async () => {
    const { sut, repository } = buildSut();
    const result = await sut.execute({ metadata, file: textFile({ originalName: '../../x/guia.txt' }) });
    const props = repository.get(result.id).document.props;
    expect(props.version).toBeNull();
    expect(props.originalFilename).toBe('guia.txt');
  });

  it('rechaza la solicitud sin archivo', async () => {
    const { sut } = buildSut();
    await expect(sut.execute({ metadata, file: undefined })).rejects.toBeInstanceOf(FileRequiredError);
  });

  it('rechaza un archivo de 0 bytes (E-04)', async () => {
    const { sut, repository, queue } = buildSut();
    await expect(sut.execute({ metadata, file: textFile({ sizeBytes: 0 }) })).rejects.toBeInstanceOf(EmptyFileError);
    expect(repository.documents.size).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it('rechaza un contenido que no corresponde al formato sin crear registro ni archivo (E-01)', async () => {
    const { sut, repository, storage } = buildSut();
    const file = textFile({ originalName: 'falso.pdf' });
    await expect(sut.execute({ metadata, file })).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
    expect(repository.documents.size).toBe(0);
    expect(storage.files.size).toBe(0);
  });

  it('aplica el limite de tamano del texto (E-02)', async () => {
    const { sut, storage } = buildSut();
    await expect(sut.execute({ metadata, file: textFile({ sizeBytes: 1001 }) })).rejects.toBeInstanceOf(
      FileTooLargeError,
    );
    expect(storage.files.size).toBe(0);
  });

  it('aplica un limite mayor a los PDF (E-02)', async () => {
    const { sut } = buildSut();
    const pdf = textFile({ originalName: 'a.pdf', head: Buffer.from('%PDF-1.7'), sizeBytes: 4000 });
    await expect(sut.execute({ metadata, file: pdf })).resolves.toMatchObject({ status: 'PROCESANDO' });
    const tooBig = textFile({ originalName: 'b.pdf', head: Buffer.from('%PDF-1.7'), sizeBytes: 5001, sha256: 'b'.repeat(64) });
    await expect(sut.execute({ metadata, file: tooBig })).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it('rechaza un contenido duplicado con el documento existente y sin guardar el archivo (E-05)', async () => {
    const { sut, storage, queue } = buildSut();
    const first = await sut.execute({ metadata, file: textFile() });

    const error = await sut.execute({ metadata, file: textFile({ tempPath: 'tmp-2' }) }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DuplicateDocumentError);
    expect((error as DuplicateDocumentError).extra.existing).toEqual({ id: first.id, status: 'PROCESANDO' });
    expect(storage.files.size).toBe(1);
    expect(queue.enqueued).toHaveLength(1);
  });

  it('conserva el estado del documento existente en la respuesta 409 (E-32)', async () => {
    const { sut, repository } = buildSut();
    const first = await sut.execute({ metadata, file: textFile() });
    repository.get(first.id).status = 'ERROR';

    const error = await sut.execute({ metadata, file: textFile() }).catch((e: unknown) => e);
    expect((error as DuplicateDocumentError).extra.existing?.status).toBe('ERROR');
  });

  it('compensa el archivo y no deja registro si falla el encolado (E-30, E-38)', async () => {
    const { sut, repository, storage, queue } = buildSut();
    queue.enqueueError = new Error('cola caida');

    await expect(sut.execute({ metadata, file: textFile() })).rejects.toThrow('cola caida');

    expect(repository.documents.size).toBe(0);
    expect(storage.files.size).toBe(0);
    expect(storage.events.map((e) => e.split(':')[0])).toEqual(['commit', 'remove']);
  });

  it('dos cargas simultaneas del mismo archivo: una prospera y la otra recibe 409 (E-33)', async () => {
    const { sut, repository, storage } = buildSut();
    // Simula la carrera: ambas pasan la comprobacion previa y la segunda choca al insertar.
    const originalFind = repository.findRefByFileSha256.bind(repository);
    let calls = 0;
    repository.findRefByFileSha256 = async (sha) => {
      calls += 1;
      return calls <= 2 ? null : originalFind(sha);
    };

    const results = await Promise.allSettled([
      sut.execute({ metadata, file: textFile({ tempPath: 'tmp-a' }) }),
      sut.execute({ metadata, file: textFile({ tempPath: 'tmp-b' }) }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(DuplicateDocumentError);
    expect(repository.documents.size).toBe(1);
    expect(storage.files.size).toBe(1);
  });

  it('un fallo al compensar el archivo no oculta el error original y queda registrado (E-38)', async () => {
    const { sut, storage, queue, warnings } = buildSut();
    queue.enqueueError = new Error('cola caida');
    storage.removeFails = true;

    await expect(sut.execute({ metadata, file: textFile() })).rejects.toThrow('cola caida');
    expect(warnings).toHaveLength(1);
  });
});
