import { PAGE_SIZE, type SearchResultItem } from '@kata/shared';
import type { SearchPage, SearchRepository } from '../domain/ports';
import { SearchDocuments } from './search-documents';

class FakeSearchRepository implements SearchRepository {
  calls: { query: string; offset: number; limit: number }[] = [];
  constructor(private readonly page: SearchPage) {}

  async search(query: string, offset: number, limit: number): Promise<SearchPage> {
    this.calls.push({ query, offset, limit });
    return this.page;
  }
}

const item = (id: string): SearchResultItem => ({
  id,
  title: 'Guia',
  author: 'Ana',
  category: 'Manuales',
  tags: [],
  version: null,
  fragments: [],
});

describe('SearchDocuments (HU-02)', () => {
  it('consulta con el tamano de pagina fijo y el desplazamiento de la pagina', async () => {
    const repository = new FakeSearchRepository({ items: [], total: 0 });
    await new SearchDocuments(repository).execute({ q: 'nestjs', page: 3 });
    expect(repository.calls).toEqual([{ query: 'nestjs', offset: 2 * PAGE_SIZE, limit: PAGE_SIZE }]);
  });

  it('devuelve los resultados con el total exacto y el numero de paginas', async () => {
    const repository = new FakeSearchRepository({ items: [item('a'), item('b')], total: 23 });
    const response = await new SearchDocuments(repository).execute({ q: 'guia', page: 1 });
    expect(response).toEqual({ items: [item('a'), item('b')], page: 1, total: 23, totalPages: 3 });
  });

  it('sin coincidencias devuelve cero paginas, sin error (E-21)', async () => {
    const repository = new FakeSearchRepository({ items: [], total: 0 });
    const response = await new SearchDocuments(repository).execute({ q: 'de la', page: 1 });
    expect(response).toEqual({ items: [], page: 1, total: 0, totalPages: 0 });
  });

  it('una pagina fuera de rango conserva el total para informar cuantas paginas hay', async () => {
    const repository = new FakeSearchRepository({ items: [], total: 12 });
    const response = await new SearchDocuments(repository).execute({ q: 'guia', page: 50 });
    expect(response).toMatchObject({ page: 50, total: 12, totalPages: 2, items: [] });
  });

  it('propaga el error del repositorio', async () => {
    const repository: SearchRepository = {
      search: async () => {
        throw new Error('base caida');
      },
    };
    await expect(new SearchDocuments(repository).execute({ q: 'x', page: 1 })).rejects.toThrow('base caida');
  });
});
