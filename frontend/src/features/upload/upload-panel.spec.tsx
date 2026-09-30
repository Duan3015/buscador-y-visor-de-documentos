import type { DocumentAccepted } from '@kata/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../shared/api/client';
import { createFakeApi, renderWithApp } from '../../test-utils';
import { UploadPanel } from './upload-panel';

const ID_1 = '3f2b8c1e-7d44-4b0e-9a55-1c2d3e4f5a6b';
const ID_2 = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

const file = (name: string) => new File(['contenido'], name, { type: 'text/plain' });

async function fillCommonFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Autor'), 'Ana Pérez');
  await user.type(screen.getByLabelText('Categoría'), 'Manuales');
  await user.type(screen.getByLabelText('Etiquetas'), 'nestjs, servidor');
  await user.type(screen.getByLabelText('Versión'), '1.2');
}

describe('UploadPanel', () => {
  it('propone el titulo desde el nombre del archivo y omite los formatos no admitidos', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderWithApp(<UploadPanel />);

    await user.upload(screen.getByLabelText(/Archivos/), [file('guia-instalacion.txt'), file('virus.exe')]);

    expect(screen.getByLabelText('Título de guia-instalacion.txt')).toHaveValue('guia-instalacion');
    expect(screen.queryByLabelText('Título de virus.exe')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('virus.exe');
  });

  it('permite quitar un archivo seleccionado', async () => {
    const user = userEvent.setup();
    renderWithApp(<UploadPanel />);
    await user.upload(screen.getByLabelText(/Archivos/), [file('a.txt'), file('b.md')]);

    await user.click(screen.getByRole('button', { name: 'Quitar a.txt' }));

    expect(screen.queryByLabelText('Título de a.txt')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Título de b.md')).toBeInTheDocument();
  });

  it('no envia y muestra los errores por campo si faltan metadatos (E-03)', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderWithApp(<UploadPanel />, { api });
    await user.upload(screen.getByLabelText(/Archivos/), file('a.txt'));
    await user.clear(screen.getByLabelText('Título de a.txt'));
    await user.type(screen.getByLabelText('Versión'), 'v1');

    await user.click(screen.getByRole('button', { name: /Cargar/ }));

    expect(api.uploadDocument).not.toHaveBeenCalled();
    expect(screen.getByText('El autor es obligatorio')).toBeInTheDocument();
    expect(screen.getByText('La categoria es obligatorio')).toBeInTheDocument();
    expect(screen.getByText('El titulo es obligatorio')).toBeInTheDocument();
    expect(screen.getByText(/La version debe tener el formato/)).toBeInTheDocument();
  });

  it('deshabilita el boton sin archivos seleccionados', () => {
    renderWithApp(<UploadPanel />);

    expect(screen.getByRole('button', { name: /Cargar/ })).toBeDisabled();
  });

  it('envia el archivo con sus metadatos y sigue el documento hasta INDEXADO por evento (HU-01, HU-04)', async () => {
    const user = userEvent.setup();
    const uploadDocument = jest.fn().mockResolvedValue({ id: ID_1, status: 'PROCESANDO' } satisfies DocumentAccepted);
    const { emit } = renderWithApp(<UploadPanel />, { api: createFakeApi({ uploadDocument }) });
    await user.upload(screen.getByLabelText(/Archivos/), file('guia.txt'));
    await fillCommonFields(user);

    await user.click(screen.getByRole('button', { name: /Cargar/ }));

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    const request = uploadDocument.mock.calls[0]?.[0] as { file: File; metadata: object };
    expect(request.file.name).toBe('guia.txt');
    expect(request.metadata).toEqual({
      title: 'guia',
      author: 'Ana Pérez',
      category: 'Manuales',
      tags: ['nestjs', 'servidor'],
      version: '1.2',
    });

    const row = await screen.findByTestId('upload-row');
    await waitFor(() => expect(within(row).getByText('PROCESANDO')).toBeInTheDocument());
    // El formulario queda listo para el siguiente lote y conserva los datos comunes.
    expect(screen.getByLabelText('Autor')).toHaveValue('Ana Pérez');
    expect(screen.queryByLabelText('Título de guia.txt')).not.toBeInTheDocument();

    await emit('document-status', { documentId: ID_1, status: 'INDEXADO', occurredAt: '2026-09-29T10:00:05Z' });

    expect(within(row).getByText('INDEXADO')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Ver documento' })).toHaveAttribute('href', `/documents/${ID_1}`);
    expect(screen.getByText(/ya está indexado y se puede buscar/)).toBeInTheDocument();
  });

  it('muestra ERROR con la causa traducida cuando el evento lo indica', async () => {
    const user = userEvent.setup();
    const uploadDocument = jest.fn().mockResolvedValue({ id: ID_1, status: 'PROCESANDO' });
    const { emit } = renderWithApp(<UploadPanel />, { api: createFakeApi({ uploadDocument }) });
    await user.upload(screen.getByLabelText(/Archivos/), file('escaneado.pdf'));
    await fillCommonFields(user);
    await user.click(screen.getByRole('button', { name: /Cargar/ }));
    const row = await screen.findByTestId('upload-row');
    await waitFor(() => expect(within(row).getByText('PROCESANDO')).toBeInTheDocument());

    await emit('document-status', { documentId: ID_1, status: 'ERROR', reason: 'NO_EXTRACTABLE_TEXT', occurredAt: '2026-09-29T10:00:05Z' });

    expect(within(row).getByText('ERROR')).toBeInTheDocument();
    expect(within(row).getByText(/no contiene texto extraíble/)).toBeInTheDocument();
    expect(screen.getByText(/no se pudo procesar/)).toBeInTheDocument();
  });

  it('no pierde el estado si el evento llega antes que la respuesta 202', async () => {
    const user = userEvent.setup();
    let accept: (value: DocumentAccepted) => void = () => undefined;
    const uploadDocument = jest.fn().mockReturnValue(new Promise<DocumentAccepted>((resolve) => (accept = resolve)));
    const { emit } = renderWithApp(<UploadPanel />, { api: createFakeApi({ uploadDocument }) });
    await user.upload(screen.getByLabelText(/Archivos/), file('rapido.txt'));
    await fillCommonFields(user);
    await user.click(screen.getByRole('button', { name: /Cargar/ }));

    await emit('document-status', { documentId: ID_1, status: 'INDEXADO', occurredAt: '2026-09-29T10:00:05Z' });
    accept({ id: ID_1, status: 'PROCESANDO' });

    const row = await screen.findByTestId('upload-row');
    await waitFor(() => expect(within(row).getByText('INDEXADO')).toBeInTheDocument());
  });

  it('envia como maximo tres archivos a la vez y deshabilita el envio mientras hay cola (E-45)', async () => {
    const user = userEvent.setup();
    const resolvers: Array<(value: DocumentAccepted) => void> = [];
    const uploadDocument = jest.fn(() => new Promise<DocumentAccepted>((resolve) => resolvers.push(resolve)));
    renderWithApp(<UploadPanel />, { api: createFakeApi({ uploadDocument }) });
    await user.upload(screen.getByLabelText(/Archivos/), ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt'].map(file));
    await fillCommonFields(user);

    await user.click(screen.getByRole('button', { name: /Cargar/ }));

    expect(uploadDocument).toHaveBeenCalledTimes(3);
    expect(screen.getAllByText('Enviando').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText('En cola')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Enviando...' })).toBeDisabled();

    resolvers[0]?.({ id: ID_1, status: 'PROCESANDO' });
    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(4));
  });

  it('muestra el rechazo por archivo y enlaza el documento existente en un 409 (E-05, E-07)', async () => {
    const user = userEvent.setup();
    const problem = {
      status: 409,
      title: 'Conflicto',
      detail: 'dup',
      code: 'DUPLICATE_DOCUMENT',
      traceId: 't-12345678',
      existing: { id: ID_2, status: 'INDEXADO' as const },
    };
    const uploadDocument = jest
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'DUPLICATE_DOCUMENT', 'dup', problem))
      .mockResolvedValueOnce({ id: ID_1, status: 'PROCESANDO' });
    renderWithApp(<UploadPanel />, { api: createFakeApi({ uploadDocument }) });
    await user.upload(screen.getByLabelText(/Archivos/), [file('repetido.txt'), file('nuevo.txt')]);
    await fillCommonFields(user);

    await user.click(screen.getByRole('button', { name: /Cargar/ }));

    const rows = await screen.findAllByTestId('upload-row');
    await waitFor(() => expect(within(rows[0]!).getByText('Rechazado')).toBeInTheDocument());
    expect(within(rows[0]!).getByText('Este archivo ya fue cargado anteriormente.')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link', { name: /Ver el documento existente/ })).toHaveAttribute('href', `/documents/${ID_2}`);
    await waitFor(() => expect(within(rows[1]!).getByText('PROCESANDO')).toBeInTheDocument());
  });

  it('limpia las cargas resueltas', async () => {
    const user = userEvent.setup();
    const uploadDocument = jest.fn().mockRejectedValue(new ApiError(413, 'FILE_TOO_LARGE', 'grande'));
    renderWithApp(<UploadPanel />, { api: createFakeApi({ uploadDocument }) });
    await user.upload(screen.getByLabelText(/Archivos/), file('enorme.txt'));
    await fillCommonFields(user);
    await user.click(screen.getByRole('button', { name: /Cargar/ }));
    await screen.findByText('El archivo supera el tamaño máximo permitido.');

    await user.click(screen.getByRole('button', { name: 'Limpiar resueltas' }));

    expect(screen.queryByTestId('upload-row')).not.toBeInTheDocument();
  });
});
