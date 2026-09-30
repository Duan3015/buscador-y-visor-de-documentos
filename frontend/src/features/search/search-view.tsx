'use client';

import { MAX_SEARCH_PAGE, SEARCH_QUERY_MAX_LENGTH, searchQuerySchema, type SearchResponse } from '@kata/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useApi } from '../../shared/api/api-context';
import { queryKeys } from '../../shared/api/query-keys';
import { describeApiError } from '../../shared/lib/error-messages';
import { Button } from '../../shared/ui/button';
import { Skeleton } from '../../shared/ui/skeleton';
import { HighlightedText } from './highlighted-text';

export interface SearchViewProps {
  /** Consulta vigente (viene de la URL). Vacia si aun no se busco. */
  query: string;
  page: number;
  onSearch(query: string): void;
  onPageChange(page: number): void;
}

function ResultSkeleton() {
  return (
    <div aria-label="Cargando resultados" role="status" className="flex flex-col gap-4">
      {[0, 1, 2].map((key) => (
        <div key={key} className="rounded-lg border border-slate-200 bg-white p-4">
          <Skeleton className="mb-3 h-5 w-1/2" />
          <Skeleton className="mb-2 h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function Results({ data, page, onPageChange }: { data: SearchResponse; page: number; onPageChange(page: number): void }) {
  if (data.total === 0) {
    return <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">No se encontraron documentos para esta búsqueda.</p>;
  }

  const lastPage = Math.min(data.totalPages, MAX_SEARCH_PAGE);
  const truncated = data.totalPages > MAX_SEARCH_PAGE;

  return (
    <section aria-label="Resultados">
      <p className="mb-4 text-sm text-slate-600">
        {data.total} {data.total === 1 ? 'resultado' : 'resultados'}
        {truncated ? ` (se pueden ver hasta ${MAX_SEARCH_PAGE} páginas)` : ''}
      </p>

      {data.items.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">Esta página no tiene resultados.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {data.items.map((item) => (
            <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <Link href={`/documents/${item.id}`} className="text-lg font-semibold text-indigo-700 hover:underline">
                {item.title}
              </Link>
              <p className="mt-1 text-sm text-slate-600">
                {item.author} · {item.category}
                {item.version ? ` · v${item.version}` : ''}
              </p>
              {item.tags.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1" aria-label="Etiquetas">
                  {item.tags.map((tag) => (
                    <li key={tag} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                      {tag}
                    </li>
                  ))}
                </ul>
              ) : null}
              {item.fragments.map((fragment, index) => (
                <p key={index} className="mt-2 text-sm text-slate-800">
                  …<HighlightedText fragment={fragment} />…
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}

      <nav aria-label="Paginación" className="mt-6 flex items-center justify-between">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Anterior
        </Button>
        <span className="text-sm text-slate-600">
          Página {page} de {lastPage}
        </span>
        <Button variant="secondary" disabled={page >= lastPage} onClick={() => onPageChange(page + 1)}>
          Siguiente
        </Button>
      </nav>
    </section>
  );
}

/** Caja de busqueda y resultados. La busqueda se ejecuta al enviar, no al escribir (ADR-12). */
export function SearchView({ query, page, onSearch, onPageChange }: SearchViewProps) {
  const api = useApi();
  const [draft, setDraft] = useState(query);
  const [formError, setFormError] = useState<string | null>(null);

  // El boton Atras cambia la URL: el campo debe reflejar la consulta vigente.
  useEffect(() => {
    setDraft(query);
    setFormError(null);
  }, [query]);

  const validation = searchQuerySchema.safeParse({ q: query, page });
  const enabled = query !== '' && validation.success;

  const result = useQuery({
    queryKey: queryKeys.search(query, page),
    queryFn: ({ signal }) => api.searchDocuments({ q: query, page }, signal),
    enabled,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim() === '') {
      setFormError('Escriba un término de búsqueda.');
      return;
    }
    const parsed = searchQuerySchema.safeParse({ q: draft, page: 1 });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'La consulta no es válida');
      return;
    }
    setFormError(null);
    onSearch(parsed.data.q);
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} role="search" className="flex flex-col gap-2" noValidate>
        <label htmlFor="search-input" className="text-sm font-medium text-slate-700">
          Buscar documentos
        </label>
        <div className="flex gap-2">
          <input
            id="search-input"
            type="search"
            value={draft}
            maxLength={SEARCH_QUERY_MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Palabra o frase entre comillas"
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? 'search-error' : undefined}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
          <Button type="submit">Buscar</Button>
        </div>
        {formError ? (
          <p id="search-error" className="text-sm text-red-600">
            {formError}
          </p>
        ) : null}
      </form>

      {query === '' ? (
        <p className="text-slate-600">Escriba un término para buscar en el título, los metadatos y el contenido de los documentos.</p>
      ) : !validation.success ? (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
          {validation.error.issues[0]?.message ?? 'La búsqueda no es válida.'}
        </p>
      ) : result.isPending ? (
        <ResultSkeleton />
      ) : result.isError ? (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
          <p>{describeApiError(result.error)}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void result.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : (
        <Results data={result.data} page={page} onPageChange={onPageChange} />
      )}
    </div>
  );
}
