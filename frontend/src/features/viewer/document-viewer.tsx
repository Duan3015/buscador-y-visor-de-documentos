'use client';

import type { DocumentDetail } from '@kata/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect } from 'react';
import { useApi } from '../../shared/api/api-context';
import { ApiError } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/query-keys';
import { describeApiError, describeDocumentError } from '../../shared/lib/error-messages';
import { Button } from '../../shared/ui/button';
import { Skeleton } from '../../shared/ui/skeleton';
import { StatusBadge } from '../../shared/ui/status-badge';
import { useStatusStore, useTrackedStatus } from '../notifications/status-events-provider';
import { DocumentContent } from './document-content';

const FORMAT_LABELS: Record<DocumentDetail['format'], string> = {
  TXT: 'Texto plano',
  MARKDOWN: 'Markdown',
  PDF: 'PDF',
};

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });
const numberFormat = new Intl.NumberFormat('es');

function formatDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : dateFormat.format(date);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Metadata({ document }: { document: DocumentDetail }) {
  const rows: Array<[string, string]> = [
    ['Autor', document.author],
    ['Categoría', document.category],
    ['Versión', document.version ?? '-'],
    ['Formato', FORMAT_LABELS[document.format]],
    ['Archivo', `${document.originalFilename} (${formatSize(document.sizeBytes)})`],
    ['Cargado', formatDate(document.createdAt)],
    ['Indexado', formatDate(document.indexedAt)],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-2">
          <dt className="w-24 shrink-0 font-medium text-slate-600">{label}</dt>
          <dd className="break-words text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ViewerSkeleton() {
  return (
    <div role="status" aria-label="Cargando documento" className="flex flex-col gap-4">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** Visor de un documento: metadatos, avisos de estado y contenido estructurado (HU-03). */
export function DocumentViewer({ id }: { id: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const store = useStatusStore();
  const tracked = useTrackedStatus(id);

  const result = useQuery({
    queryKey: queryKeys.document(id),
    queryFn: ({ signal }) => api.getDocument(id, signal),
    // Un 404 no cambia al reintentar.
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  });

  const detail = result.data;

  // Mientras el documento se procesa se sigue por SSE; al terminar el evento invalida esta consulta.
  useEffect(() => {
    if (detail?.status === 'PROCESANDO') store.track(id);
  }, [detail?.status, id, store]);

  // Si el evento llego antes de que el visor empezara a seguir el documento, se recarga el detalle.
  useEffect(() => {
    if (detail?.status === 'PROCESANDO' && tracked && tracked.status !== 'PROCESANDO') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.document(id) });
    }
  }, [detail?.status, tracked, id, queryClient]);

  if (result.isPending) return <ViewerSkeleton />;

  if (result.isError && !detail) {
    const notFound = result.error instanceof ApiError && result.error.code === 'DOCUMENT_NOT_FOUND';
    return (
      <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
        <p>{describeApiError(result.error)}</p>
        <div className="mt-3 flex gap-2">
          {notFound ? null : (
            <Button variant="secondary" onClick={() => void result.refetch()}>
              Reintentar
            </Button>
          )}
          <Link href="/" className="inline-flex items-center px-2 text-sm font-medium text-indigo-700 hover:underline">
            Volver al buscador
          </Link>
        </div>
      </div>
    );
  }

  if (!detail) return null;
  const data = detail;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm font-medium text-indigo-700 hover:underline">
          Volver al buscador
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{data.title}</h1>
          <StatusBadge status={data.status} />
        </div>
      </div>

      <section aria-label="Metadatos" className="rounded-lg border border-slate-200 bg-white p-4">
        <Metadata document={data} />
        {data.tags.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1" aria-label="Etiquetas">
            {data.tags.map((tag) => (
              <li key={tag} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {tag}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {data.status === 'PROCESANDO' ? (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
          El documento se está procesando. Esta página se actualizará automáticamente cuando termine.
        </p>
      ) : null}

      {data.status === 'ERROR' ? (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
          {describeDocumentError(data.error?.code)}
        </p>
      ) : null}

      {data.isPartiallyIndexed && data.indexedChars !== null && data.totalChars !== null ? (
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
          Documento indexado parcialmente: la búsqueda cubre los primeros {numberFormat.format(data.indexedChars)} de{' '}
          {numberFormat.format(data.totalChars)} caracteres. El contenido completo se muestra aquí.
        </p>
      ) : null}

      {data.content !== null ? <DocumentContent content={data.content} format={data.format} /> : null}
    </div>
  );
}
