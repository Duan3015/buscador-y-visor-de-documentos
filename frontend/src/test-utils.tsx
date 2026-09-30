import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { StatusEventsProvider, type EventSourceLike } from './features/notifications/status-events-provider';
import { ApiProvider } from './shared/api/api-context';
import type { ApiClient } from './shared/api/client';
import { ToastProvider } from './shared/ui/toast';

/** Cliente de API con todas las operaciones como dobles; cada prueba sobrescribe las que usa. */
export function createFakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    eventsUrl: 'http://api.test/api/events',
    searchDocuments: jest.fn(),
    getDocument: jest.fn(),
    getStatuses: jest.fn().mockResolvedValue({ items: [] }),
    uploadDocument: jest.fn(),
    ...overrides,
  };
}

/** Doble de EventSource controlable desde la prueba. */
export class FakeEventSource implements EventSourceLike {
  readyState = 0;
  private readonly listeners = new Map<string, Array<(event: Event) => void>>();

  addEventListener(type: string, listener: (event: MessageEvent<string> | Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener as (event: Event) => void]);
  }

  close(): void {
    this.readyState = 2;
  }

  emit(type: string, data?: unknown): void {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/** Renderiza con los proveedores reales de la aplicacion y un canal de eventos falso. */
export function renderWithApp(ui: ReactElement, options: { api?: ApiClient } = {}) {
  const api = options.api ?? createFakeApi();
  const source = new FakeEventSource();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <StatusEventsProvider eventSourceFactory={() => source}>
          <ToastProvider>{children}</ToastProvider>
        </StatusEventsProvider>
      </ApiProvider>
    </QueryClientProvider>
  );

  const view = render(ui, { wrapper });
  return {
    ...view,
    api,
    queryClient,
    /** Simula un evento SSE del servidor. */
    emit: (type: string, data?: unknown) => act(async () => source.emit(type, data)),
  };
}
