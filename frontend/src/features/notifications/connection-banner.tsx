'use client';

import { useConnectionState } from './status-events-provider';

/** Aviso cuando el canal de eventos no esta disponible (E-44). El estado se reconcilia al reconectar. */
export function ConnectionBanner() {
  const connection = useConnectionState();
  if (connection !== 'closed') return null;

  return (
    <div role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
      Sin actualizaciones en tiempo real. Se reintentará la conexión automáticamente y los estados se sincronizarán al volver.
    </div>
  );
}
