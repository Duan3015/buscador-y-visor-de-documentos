'use client';

import {
  DOCUMENT_STATUS_EVENT,
  MAX_IDS_PER_REQUEST,
  RESYNC_EVENT,
  documentStatusEventSchema,
} from '@kata/shared';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useApi } from '../../shared/api/api-context';
import { StatusStore, type TrackedStatus } from './status-store';

/** Subconjunto de EventSource que usa el proveedor (permite un doble en las pruebas). */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent<string> | Event) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export type ConnectionState = 'connecting' | 'open' | 'closed';

const CLOSED = 2;
/** Espera antes de reabrir una conexion que el navegador dio por cerrada (por ejemplo, tras un 503). */
export const RECONNECT_DELAY_MS = 5000;

interface StatusEventsValue {
  store: StatusStore;
  connection: ConnectionState;
}

const StatusEventsContext = createContext<StatusEventsValue | null>(null);

const defaultFactory: EventSourceFactory = (url) => new EventSource(url);

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

/**
 * Una unica conexion EventSource por pestana (ADR-07, ADR-12). Cada evento actualiza el estado
 * en memoria de los documentos seguidos; quien los muestra (cola de carga, visor) reacciona a ese
 * estado. Al abrir o reabrir la conexion y ante `resync` se reconcilia con GET /documents?ids=,
 * nunca con sondeo periodico.
 */
export function StatusEventsProvider({
  children,
  eventSourceFactory = defaultFactory,
}: {
  children: ReactNode;
  eventSourceFactory?: EventSourceFactory;
}) {
  const api = useApi();
  const store = useMemo(() => new StatusStore(), []);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  useEffect(() => {
    let disposed = false;
    let source: EventSourceLike | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const reconcile = async (): Promise<void> => {
      const pending = store.pendingIds();
      for (const ids of chunk(pending, MAX_IDS_PER_REQUEST)) {
        try {
          const { items } = await api.getStatuses(ids);
          if (disposed) return;
          for (const item of items) {
            store.apply(item.id, item.status, item.errorCode);
          }
        } catch {
          // La reconciliacion es de mejor esfuerzo: el proximo evento o reconexion la repite.
        }
      }
    };

    const onStatus = (event: MessageEvent<string> | Event): void => {
      if (!('data' in event)) return;
      let parsed: ReturnType<typeof documentStatusEventSchema.safeParse>;
      try {
        parsed = documentStatusEventSchema.safeParse(JSON.parse(event.data));
      } catch {
        return;
      }
      if (!parsed.success) return;
      const { documentId, status, reason } = parsed.data;
      store.apply(documentId, status, reason ?? null);
    };

    const connect = (): void => {
      if (disposed) return;
      setConnection('connecting');
      const current = eventSourceFactory(api.eventsUrl);
      source = current;

      current.addEventListener('open', () => {
        if (disposed || source !== current) return;
        setConnection('open');
        void reconcile();
      });
      current.addEventListener(DOCUMENT_STATUS_EVENT, onStatus);
      current.addEventListener(RESYNC_EVENT, () => {
        if (!disposed && source === current) void reconcile();
      });
      current.addEventListener('error', () => {
        if (disposed || source !== current) return;
        setConnection('closed');
        // Si el navegador reintenta solo (readyState CONNECTING) no hay nada que hacer.
        if (current.readyState === CLOSED) {
          current.close();
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      });
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [api, eventSourceFactory, store]);

  const value = useMemo(() => ({ store, connection }), [store, connection]);
  return <StatusEventsContext.Provider value={value}>{children}</StatusEventsContext.Provider>;
}

function useStatusEvents(): StatusEventsValue {
  const value = useContext(StatusEventsContext);
  if (!value) throw new Error('Debe usarse dentro de StatusEventsProvider');
  return value;
}

/** Estado de la conexion en tiempo real (para el aviso "sin actualizaciones", E-44). */
export function useConnectionState(): ConnectionState {
  return useStatusEvents().connection;
}

/** Almacen de estados seguidos (para iniciar el seguimiento de un documento). */
export function useStatusStore(): StatusStore {
  return useStatusEvents().store;
}

/** Estado en tiempo real de un documento seguido, o undefined si no se sigue. */
export function useTrackedStatus(id: string | null | undefined): TrackedStatus | undefined {
  const { store } = useStatusEvents();
  return useSyncExternalStore(
    store.subscribe,
    () => (id ? store.get(id) : undefined),
    () => undefined,
  );
}
