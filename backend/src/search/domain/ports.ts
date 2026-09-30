import type { SearchResultItem } from '@kata/shared';

export const SEARCH_REPOSITORY = Symbol('SearchRepository');

export interface SearchPage {
  items: SearchResultItem[];
  /** Total exacto de coincidencias, no solo de la pagina. */
  total: number;
}

export interface SearchRepository {
  /** Solo considera documentos INDEXADO (E-20). Ordena por relevancia. */
  search(query: string, offset: number, limit: number): Promise<SearchPage>;
}
