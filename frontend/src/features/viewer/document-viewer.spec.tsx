import type { DocumentDetail } from '@kata/shared';
import { screen, waitFor } from '@testing-library/react';
import { ApiError } from '../../shared/api/client';
import { createFakeApi, renderWithApp } from '../../test-utils';
import { DocumentViewer } from './document-viewer';

const ID = '3f2b8c1e-7d44-4b0e-9a55-1c2d3e4f5a6b';

const indexed: DocumentDetail = {
  id: ID,
  title: 'Guía de instalación',
  author: 'Ana Pérez',
  category: 'Manuales',
  tags: ['nestjs', 'servidor'],
  version: '1.2',
  format: 'TXT',
  originalFilename: 'guia.txt',
  sizeBytes: 2048,
  status: 'INDEXADO',
  error: null,
  createdAt: '2026-09-29T10:00:00.000Z',
  indexedAt: '2026-09-29T10:00:05.000Z',
  content: 'Primer párrafo.\n\nSegundo párrafo.',
  totalChars: 33,
  indexedChars: 33,
  isPartiallyIndexed: false,
};

describe('DocumentViewer', () => {
  it('muestra metadatos, etiquetas y contenido de un documento INDEXADO', async () => {
    const api = createFakeApi({ getDocument: jest.fn().mockResolvedValue(indexed) });

    renderWithApp(<DocumentViewer id={ID} />, { api });

    expect(await screen.findByRole('heading', { level: 1, name: 'Guía de instalación' })).toBeInTheDocument();
    expect(screen.getByText('INDEXADO')).toBeInTheDocument();
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('Manuales')).toBeInTheDocument();
    expect(screen.getByText('1.2')).toBeInTheDocument();
    expect(screen.getByText('guia.txt (2.0 KB)')).toBeInTheDocument();
    expect(screen.getByText('nestjs')).toBeInTheDocument();
    expect(screen.getByLabelText('Contenido del documento')).toHaveTextContent('Segundo párrafo.');
    expect(screen.queryByRole('link', { name: /descargar/i })).not.toBeInTheDocument();
  });

  it('muestra un esqueleto mientras carga', () => {
    const api = createFakeApi({ getDocument: jest.fn().mockReturnValue(new Promise(() => undefined)) });

    renderWithApp(<DocumentViewer id={ID} />, { api });

    expect(screen.getByLabelText('Cargando documento')).toBeInTheDocument();
  });

  it('avisa la indexacion parcial con las cifras', async () => {
    const partial = { ...indexed, isPartiallyIndexed: true, indexedChars: 300000, totalChars: 1250000 };
    const api = createFakeApi({ getDocument: jest.fn().mockResolvedValue(partial) });

    renderWithApp(<DocumentViewer id={ID} />, { api });

    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('indexado parcialmente');
    expect(note.textContent).toContain('300.000');
    expect(note.textContent).toContain('1.250.000');
  });

  it('traduce la causa de un documento en ERROR y no muestra contenido', async () => {
    const failed: DocumentDetail = {
      ...indexed,
      status: 'ERROR',
      error: { code: 'NO_EXTRACTABLE_TEXT', attempts: 1 },
      content: null,
      totalChars: null,
      indexedChars: null,
      isPartiallyIndexed: null,
      indexedAt: null,
    };
    const api = createFakeApi({ getDocument: jest.fn().mockResolvedValue(failed) });

    renderWithApp(<DocumentViewer id={ID} />, { api });

    expect(await screen.findByRole('alert')).toHaveTextContent('El PDF no contiene texto extraíble');
    expect(screen.queryByLabelText('Contenido del documento')).not.toBeInTheDocument();
  });

  it('en PROCESANDO avisa, sigue el documento y se actualiza al llegar el evento (HU-04)', async () => {
    const processing: DocumentDetail = {
      ...indexed,
      status: 'PROCESANDO',
      content: null,
      totalChars: null,
      indexedChars: null,
      isPartiallyIndexed: null,
      indexedAt: null,
    };
    const getDocument = jest.fn().mockResolvedValueOnce(processing).mockResolvedValue(indexed);
    const { emit } = renderWithApp(<DocumentViewer id={ID} />, { api: createFakeApi({ getDocument }) });

    expect(await screen.findByText(/El documento se está procesando/)).toBeInTheDocument();

    await emit('document-status', { documentId: ID, status: 'INDEXADO', occurredAt: '2026-09-29T10:00:05Z' });

    await waitFor(() => expect(screen.getByLabelText('Contenido del documento')).toBeInTheDocument());
    expect(screen.queryByText(/El documento se está procesando/)).not.toBeInTheDocument();
    expect(getDocument).toHaveBeenCalledTimes(2);
  });

  it('recarga el detalle si el evento llego antes de empezar el seguimiento', async () => {
    const processing: DocumentDetail = { ...indexed, status: 'PROCESANDO', content: null, indexedAt: null };
    const getDocument = jest.fn().mockResolvedValueOnce(processing).mockResolvedValue(indexed);
    const { emit } = renderWithApp(<DocumentViewer id={ID} />, { api: createFakeApi({ getDocument }) });
    // El evento llega antes de que el detalle (aun en PROCESANDO) haya iniciado el seguimiento.
    await emit('document-status', { documentId: ID, status: 'INDEXADO', occurredAt: '2026-09-29T10:00:05Z' });

    await waitFor(() => expect(screen.getByLabelText('Contenido del documento')).toBeInTheDocument());
  });

  it('muestra un 404 sin boton de reintento y con enlace al buscador', async () => {
    const api = createFakeApi({
      getDocument: jest.fn().mockRejectedValue(new ApiError(404, 'DOCUMENT_NOT_FOUND', 'no existe')),
    });

    renderWithApp(<DocumentViewer id={ID} />, { api });

    expect(await screen.findByRole('alert')).toHaveTextContent('El documento no existe.');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al buscador' })).toHaveAttribute('href', '/');
  });

  it('ofrece reintentar ante un fallo de red', async () => {
    const getDocument = jest
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'sin red'))
      .mockResolvedValue(indexed);
    renderWithApp(<DocumentViewer id={ID} />, { api: createFakeApi({ getDocument }) });

    const retry = await screen.findByRole('button', { name: 'Reintentar' });
    retry.click();

    expect(await screen.findByRole('heading', { level: 1, name: 'Guía de instalación' })).toBeInTheDocument();
  });
});
