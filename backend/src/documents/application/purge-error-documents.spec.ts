import { Document } from '../domain/document';
import type { DocumentErrorCode } from '@kata/shared';
import { InMemoryDocumentRepository, InMemoryFileStorage, InMemoryUnitOfWork } from '../testing/fakes';
import { PurgeErrorDocuments } from './purge-error-documents';

const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];

async function setup() {
  const repository = new InMemoryDocumentRepository();
  const storage = new InMemoryFileStorage();
  const unitOfWork = new InMemoryUnitOfWork([repository]);

  const add = async (id: string, index: number, outcome: 'ERROR' | 'INDEXADO' | 'PROCESANDO', code?: DocumentErrorCode) => {
    await unitOfWork.run((ctx) =>
      repository.insert(
        ctx,
        Document.create({
          id,
          title: `Documento ${index}`,
          author: 'Ana',
          category: 'Manuales',
          tags: [],
          version: null,
          format: 'PDF',
          originalFilename: 'x.pdf',
          sizeBytes: 10,
          fileSha256: String(index).repeat(64),
          createdAt: new Date('2026-09-29T12:00:00Z'),
        }),
      ),
    );
    storage.files.set(id, Buffer.from('contenido'));
    const stored = repository.get(id);
    stored.status = outcome;
    stored.lastErrorCode = code ?? null;
  };

  await add(ids[0] as string, 1, 'ERROR', 'PDF_CORRUPT');
  await add(ids[1] as string, 2, 'ERROR', 'NO_EXTRACTABLE_TEXT');
  await add(ids[2] as string, 3, 'INDEXADO');

  const messages: string[] = [];
  const logger = {
    info: (message: string) => messages.push(`info:${message}`),
    warn: (message: string) => messages.push(`warn:${message}`),
    error: (message: string) => messages.push(`error:${message}`),
  };
  return { sut: new PurgeErrorDocuments(repository, storage, logger), repository, storage, messages };
}

describe('PurgeErrorDocuments', () => {
  it('sin confirmacion solo informa los candidatos y no elimina nada (simulacro)', async () => {
    const { sut, repository, storage } = await setup();

    const report = await sut.execute({ filter: {}, confirm: false });

    expect(report.candidates.map((candidate) => candidate.id)).toEqual([ids[0], ids[1]]);
    expect(report.deleted).toBe(0);
    expect(repository.documents.size).toBe(3);
    expect(storage.files.size).toBe(3);
  });

  it('con confirmacion elimina los documentos en ERROR y sus archivos, y respeta los demas', async () => {
    const { sut, repository, storage } = await setup();

    const report = await sut.execute({ filter: {}, confirm: true });

    expect(report).toMatchObject({ deleted: 2, skipped: 0, failed: 0, orphanFiles: [] });
    expect([...repository.documents.keys()]).toEqual([ids[2]]);
    expect([...storage.files.keys()]).toEqual([ids[2]]);
  });

  it('el archivo se puede volver a subir: la huella deja de estar registrada', async () => {
    const { sut, repository } = await setup();

    await sut.execute({ filter: {}, confirm: true });

    expect(await repository.findRefByFileSha256('1'.repeat(64))).toBeNull();
    expect(await repository.findRefByFileSha256('3'.repeat(64))).not.toBeNull();
  });

  it('filtra por codigo de error', async () => {
    const { sut, repository } = await setup();

    const report = await sut.execute({ filter: { code: 'PDF_CORRUPT' }, confirm: true });

    expect(report.deleted).toBe(1);
    expect(repository.documents.has(ids[0] as string)).toBe(false);
    expect(repository.documents.has(ids[1] as string)).toBe(true);
  });

  it('omite un documento que dejo de estar en ERROR entre el listado y el borrado', async () => {
    const { sut, repository, storage } = await setup();
    const original = repository.listErrorDocuments.bind(repository);
    repository.listErrorDocuments = async (filter) => {
      const listed = await original(filter);
      repository.get(ids[0] as string).status = 'INDEXADO';
      return listed;
    };

    const report = await sut.execute({ filter: {}, confirm: true });

    expect(report).toMatchObject({ deleted: 1, skipped: 1 });
    expect(repository.documents.has(ids[0] as string)).toBe(true);
    expect(storage.files.has(ids[0] as string)).toBe(true);
  });

  it('un fallo en un documento no detiene a los demas y no toca su archivo', async () => {
    const { sut, repository, storage, messages } = await setup();
    const original = repository.deleteErrorDocument.bind(repository);
    repository.deleteErrorDocument = async (id) => {
      if (id === ids[0]) throw new Error('base de datos caida');
      return original(id);
    };

    const report = await sut.execute({ filter: {}, confirm: true });

    expect(report).toMatchObject({ deleted: 1, failed: 1 });
    expect(storage.files.has(ids[0] as string)).toBe(true);
    expect(storage.files.has(ids[1] as string)).toBe(false);
    expect(messages.some((message) => message.startsWith('error:') && message.includes('base de datos caida'))).toBe(true);
  });

  it('si falla el borrado del archivo lo informa como huerfano sin revertir el registro', async () => {
    const { sut, repository, storage } = await setup();
    storage.removeFails = true;

    const report = await sut.execute({ filter: {}, confirm: true });

    expect(report.deleted).toBe(2);
    expect(report.orphanFiles).toEqual([ids[0], ids[1]]);
    expect(repository.documents.has(ids[0] as string)).toBe(false);
  });

  it('sin candidatos no hace nada', async () => {
    const repository = new InMemoryDocumentRepository();
    const sut = new PurgeErrorDocuments(repository, new InMemoryFileStorage());

    const report = await sut.execute({ filter: {}, confirm: true });

    expect(report).toEqual({ candidates: [], deleted: 0, skipped: 0, failed: 0, orphanFiles: [] });
  });
});
