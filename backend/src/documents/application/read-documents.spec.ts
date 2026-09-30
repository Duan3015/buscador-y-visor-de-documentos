import type { DocumentDetail, DocumentStatusItem } from '@kata/shared';
import { DocumentNotFoundError } from '../../shared-kernel/errors';
import { InMemoryDocumentRepository } from '../testing/fakes';
import { GetDocument } from './get-document';
import { GetDocumentsByIds } from './get-documents-by-ids';

const detail = (overrides: Partial<DocumentDetail> = {}): DocumentDetail => ({
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Guia',
  author: 'Ana',
  category: 'Manuales',
  tags: [],
  version: null,
  format: 'TXT',
  originalFilename: 'guia.txt',
  sizeBytes: 10,
  status: 'INDEXADO',
  error: null,
  createdAt: '2026-09-29T12:00:00.000Z',
  indexedAt: '2026-09-29T12:00:05.000Z',
  content: 'texto',
  totalChars: 5,
  indexedChars: 5,
  isPartiallyIndexed: false,
  ...overrides,
});

describe('GetDocument (HU-03, E-23)', () => {
  it('devuelve el detalle con metadatos y contenido', async () => {
    const repository = new InMemoryDocumentRepository();
    repository.findDetailById = async () => detail();
    await expect(new GetDocument(repository).execute('x')).resolves.toEqual(detail());
  });

  it.each([
    ['PROCESANDO', { status: 'PROCESANDO' as const, content: null, indexedAt: null }],
    ['ERROR', { status: 'ERROR' as const, content: null, error: { code: 'PDF_CORRUPT' as const, attempts: 1 } }],
  ])('un documento en %s se devuelve con su estado y sin contenido', async (_name, overrides) => {
    const repository = new InMemoryDocumentRepository();
    repository.findDetailById = async () => detail(overrides);
    const result = await new GetDocument(repository).execute('x');
    expect(result.content).toBeNull();
    expect(result.status).toBe(overrides.status);
  });

  it('lanza DocumentNotFoundError si el documento no existe', async () => {
    const repository = new InMemoryDocumentRepository();
    repository.findDetailById = async () => null;
    await expect(new GetDocument(repository).execute('x')).rejects.toBeInstanceOf(DocumentNotFoundError);
  });
});

describe('GetDocumentsByIds (ADR-07)', () => {
  it('devuelve el estado de los documentos que existen y omite los inexistentes', async () => {
    const repository = new InMemoryDocumentRepository();
    const items: DocumentStatusItem[] = [{ id: 'a', status: 'INDEXADO', errorCode: null }];
    repository.findStatusesByIds = async (ids) => {
      expect(ids).toEqual(['a', 'b']);
      return items;
    };
    await expect(new GetDocumentsByIds(repository).execute(['a', 'b'])).resolves.toEqual({ items });
  });
});
