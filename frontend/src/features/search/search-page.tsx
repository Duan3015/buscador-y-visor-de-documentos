'use client';

import { MAX_SEARCH_PAGE } from '@kata/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { SearchView } from './search-view';

/** Interpreta el numero de pagina de la URL; un valor invalido vuelve a la primera pagina. */
export function parsePageParam(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return page >= 1 && page <= MAX_SEARCH_PAGE ? page : 1;
}

/** Contenedor: la consulta y la pagina viven en la URL (enlazable, Atras funciona, recarga conserva). */
export function SearchPage() {
  const router = useRouter();
  const params = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const page = parsePageParam(params.get('page'));

  const go = (nextQuery: string, nextPage: number) => {
    router.push(`/?${new URLSearchParams({ q: nextQuery, page: String(nextPage) }).toString()}`);
  };

  return <SearchView query={query} page={page} onSearch={(q) => go(q, 1)} onPageChange={(p) => go(query, p)} />;
}
