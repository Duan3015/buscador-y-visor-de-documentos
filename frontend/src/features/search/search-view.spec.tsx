import { HIGHLIGHT_END, HIGHLIGHT_START, type SearchResponse } from '@kata/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiProvider } from '../../shared/api/api-context';
import { ApiError, type ApiClient } from '../../shared/api/client';
import { SearchView, type SearchViewProps } from './search-view';

const ID_A = '3f2b8c1e-7d44-4b0e-9a55-1c2d3e4f5a6b';
const ID_B = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

const response: SearchResponse = {
  items: [
    {
      id: ID_A,
      title: 'Guía de instalación',
      author: 'Ana Pérez',
      category: 'Manuales',
      tags: ['nestjs', 'servidor'],
      version: '1.2',
      fragments: [`pasos para la ${HIGHLIGHT_START}instalación${HIGHLIGHT_END} del servidor`],
    },
    { id: ID_B, title: 'Solo título', author: 'Luis', category: 'Notas', tags: [], version: null, fragments: [] },
  ],
  page: 1,
  total: 25,
  totalPages: 3,
};

function fakeApi(searchDocuments: ApiClient['searchDocuments']): ApiClient {
  return {
    eventsUrl: 'http://api.test/api/events',
    searchDocuments,
    getDocument: jest.fn(),
    getStatuses: jest.fn(),
    uploadDocument: jest.fn(),
  };
}

function renderView(api: ApiClient, props: Partial<SearchViewProps> = {}) {
  const handlers = { onSearch: jest.fn(), onPageChange: jest.fn() };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <SearchView query="" page={1} {...handlers} {...props} />
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { ...view, ...handlers };
}

describe('SearchView', () => {
  it('sin consulta muestra la ayuda y no llama a la API', () => {
    const search = jest.fn();
    renderView(fakeApi(search));

    expect(screen.getByText(/Escriba un término/)).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
  });

  it('envia la consulta recortada al enviar el formulario', async () => {
    const { onSearch } = renderView(fakeApi(jest.fn()));

    await userEvent.type(screen.getByLabelText('Buscar documentos'), '  instalación  {Enter}');

    expect(onSearch).toHaveBeenCalledWith('instalación');
  });

  it('no busca mientras se escribe', async () => {
    const search = jest.fn();
    renderView(fakeApi(search));

    await userEvent.type(screen.getByLabelText('Buscar documentos'), 'instalación');

    expect(search).not.toHaveBeenCalled();
  });

  it('rechaza una consulta vacia en el formulario (E-16)', async () => {
    const { onSearch } = renderView(fakeApi(jest.fn()));

    await userEvent.type(screen.getByLabelText('Buscar documentos'), '   {Enter}');

    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByText('Escriba un término de búsqueda.')).toBeInTheDocument();
  });

  it('muestra esqueleto y luego resultados con metadatos, etiquetas y coincidencias resaltadas', async () => {
    let resolveSearch: (value: SearchResponse) => void = () => undefined;
    const search = jest.fn().mockReturnValue(new Promise<SearchResponse>((resolve) => (resolveSearch = resolve)));
    renderView(fakeApi(search), { query: 'instalacion' });

    expect(screen.getByLabelText('Cargando resultados')).toBeInTheDocument();
    resolveSearch(response);

    const link = await screen.findByRole('link', { name: 'Guía de instalación' });
    expect(link).toHaveAttribute('href', `/documents/${ID_A}`);
    expect(screen.getByText('Ana Pérez · Manuales · v1.2')).toBeInTheDocument();
    expect(screen.getByText('nestjs')).toBeInTheDocument();
    expect(screen.getByText('instalación', { selector: 'mark' })).toBeInTheDocument();
    expect(screen.getByText('25 resultados')).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith({ q: 'instalacion', page: 1 }, expect.any(AbortSignal));
  });

  it('pagina con anterior y siguiente segun la pagina actual', async () => {
    const search = jest.fn().mockResolvedValue({ ...response, page: 2 });
    const { onPageChange } = renderView(fakeApi(search), { query: 'instalacion', page: 2 });

    await screen.findByText('Página 2 de 3');
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }));

    expect(onPageChange).toHaveBeenNthCalledWith(1, 3);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 1);
  });

  it('deshabilita Anterior en la primera pagina y Siguiente en la ultima', async () => {
    const search = jest.fn().mockResolvedValue({ ...response, page: 3 });
    renderView(fakeApi(search), { query: 'instalacion', page: 3 });

    await screen.findByText('Página 3 de 3');

    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled();
  });

  it('muestra el estado vacio sin resultados', async () => {
    const search = jest.fn().mockResolvedValue({ items: [], page: 1, total: 0, totalPages: 0 });
    renderView(fakeApi(search), { query: 'nada' });

    expect(await screen.findByText('No se encontraron documentos para esta búsqueda.')).toBeInTheDocument();
  });

  it('avisa cuando la pagina pedida esta fuera de rango pero hay resultados', async () => {
    const search = jest.fn().mockResolvedValue({ items: [], page: 9, total: 12, totalPages: 2 });
    renderView(fakeApi(search), { query: 'informe', page: 9 });

    expect(await screen.findByText('Esta página no tiene resultados.')).toBeInTheDocument();
  });

  it('traduce el error de la API y permite reintentar', async () => {
    const search = jest
      .fn()
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'detalle'))
      .mockResolvedValueOnce(response);
    renderView(fakeApi(search), { query: 'instalacion' });

    expect(await screen.findByRole('alert')).toHaveTextContent('El servicio no está disponible');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('link', { name: 'Guía de instalación' })).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('no consulta la API con una consulta invalida de la URL', () => {
    const search = jest.fn();
    renderView(fakeApi(search), { query: 'x'.repeat(201) });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
  });

  it('refleja en el campo la consulta vigente cuando cambia la URL', async () => {
    const search = jest.fn().mockResolvedValue({ items: [], page: 1, total: 0, totalPages: 0 });
    const api = fakeApi(search);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (query: string) => (
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={api}>
          <SearchView query={query} page={1} onSearch={jest.fn()} onPageChange={jest.fn()} />
        </ApiProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(tree('uno'));
    await waitFor(() => expect(screen.getByLabelText('Buscar documentos')).toHaveValue('uno'));

    rerender(tree('dos'));

    await waitFor(() => expect(screen.getByLabelText('Buscar documentos')).toHaveValue('dos'));
  });
});
