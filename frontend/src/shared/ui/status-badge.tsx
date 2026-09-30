import type { DocumentStatus } from '@kata/shared';

/** Estados de una fila de carga, incluidos los previos a que el servidor acepte el archivo. */
export type DisplayStatus = DocumentStatus | 'EN_COLA' | 'ENVIANDO' | 'RECHAZADO';

const STYLES: Record<DisplayStatus, string> = {
  EN_COLA: 'bg-slate-100 text-slate-700',
  ENVIANDO: 'bg-sky-100 text-sky-800',
  PROCESANDO: 'bg-amber-100 text-amber-800',
  INDEXADO: 'bg-emerald-100 text-emerald-800',
  ERROR: 'bg-red-100 text-red-800',
  RECHAZADO: 'bg-red-100 text-red-800',
};

const LABELS: Record<DisplayStatus, string> = {
  EN_COLA: 'En cola',
  ENVIANDO: 'Enviando',
  PROCESANDO: 'PROCESANDO',
  INDEXADO: 'INDEXADO',
  ERROR: 'ERROR',
  RECHAZADO: 'Rechazado',
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
