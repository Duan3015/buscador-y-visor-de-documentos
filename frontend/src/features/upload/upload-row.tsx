'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { describeDocumentError } from '../../shared/lib/error-messages';
import { StatusBadge, type DisplayStatus } from '../../shared/ui/status-badge';
import { useToasts } from '../../shared/ui/toast';
import { useTrackedStatus } from '../notifications/status-events-provider';
import type { UploadItem } from './upload-queue';

function displayStatus(item: UploadItem, tracked: ReturnType<typeof useTrackedStatus>): DisplayStatus {
  switch (item.state) {
    case 'EN_COLA':
      return 'EN_COLA';
    case 'ENVIANDO':
      return 'ENVIANDO';
    case 'RECHAZADO':
      return 'RECHAZADO';
    case 'ACEPTADO':
      return tracked?.status ?? 'PROCESANDO';
  }
}

/** Fila de la cola de carga: sigue en tiempo real el estado del documento aceptado (HU-04). */
export function UploadRow({ item }: { item: UploadItem }) {
  const tracked = useTrackedStatus(item.documentId);
  const toasts = useToasts();
  const status = displayStatus(item, tracked);
  const announced = useRef<DisplayStatus | null>(null);

  // Un aviso por transicion final; no se repite al volver a renderizar.
  useEffect(() => {
    if (item.state !== 'ACEPTADO') return;
    if (status !== 'INDEXADO' && status !== 'ERROR') return;
    if (announced.current === status) return;
    announced.current = status;
    if (status === 'INDEXADO') toasts.push(`"${item.metadata.title}" ya está indexado y se puede buscar.`, 'success');
    else toasts.push(`"${item.metadata.title}" no se pudo procesar.`, 'error');
  }, [item.state, item.metadata.title, status, toasts]);

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4" data-testid="upload-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{item.metadata.title}</p>
          <p className="truncate text-xs text-slate-500">{item.file.name}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      {item.state === 'RECHAZADO' ? (
        <div className="mt-2 text-sm text-red-700">
          <p>{item.message}</p>
          {item.existing ? (
            <Link href={`/documents/${item.existing.id}`} className="font-medium text-indigo-700 underline">
              Ver el documento existente ({item.existing.status})
            </Link>
          ) : null}
        </div>
      ) : null}

      {item.state === 'ACEPTADO' && status === 'PROCESANDO' ? (
        <p className="mt-2 text-sm text-slate-600">Recibido. Se está extrayendo y indexando el contenido.</p>
      ) : null}

      {item.state === 'ACEPTADO' && status === 'ERROR' ? (
        <p className="mt-2 text-sm text-red-700">{describeDocumentError(tracked?.errorCode)}</p>
      ) : null}

      {item.state === 'ACEPTADO' && item.documentId && status !== 'PROCESANDO' && status !== 'ERROR' ? (
        <Link href={`/documents/${item.documentId}`} className="mt-2 inline-block text-sm font-medium text-indigo-700 underline">
          Ver documento
        </Link>
      ) : null}
    </li>
  );
}
