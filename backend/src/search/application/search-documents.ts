import { PAGE_SIZE, offsetFor, totalPagesFor, type SearchQuery, type SearchResponse } from '@kata/shared';
import type { SearchRepository } from '../domain/ports';

/** Caso de uso de la busqueda (HU-02): pagina fija, total exacto y calculo de paginas. */
export class SearchDocuments {
  constructor(private readonly repository: SearchRepository) {}

  async execute(query: SearchQuery): Promise<SearchResponse> {
    const { items, total } = await this.repository.search(query.q, offsetFor(query.page), PAGE_SIZE);
    return {
      items,
      page: query.page,
      total,
      totalPages: totalPagesFor(total),
    };
  }
}
