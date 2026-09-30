import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ApiProvider } from '../../shared/api/api-context';
import type { ApiClient } from '../../shared/api/client';
import {
  RECONNECT_DELAY_MS,
  StatusEventsProvider,
  useConnectionState,
  useStatusStore,
  useTrackedStatus,
  type EventSourceLike,
} from './status-events-provider';

const ID = '3f2b8c1e-7d44-4b0e-9a55-1c2d3e4f5a6b';
const OTHER = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  private readonly listeners = new Map<string, Array<(event: Event) => void>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string> | Event) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener as (event: Event) => void);
    this.listeners.set(type, list);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  emit(type: string, data?: unknown): void {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    eventsUrl: 'http://api.test/api/events',
    searchDocuments: jest.fn(),
    getDocument: jest.fn(),
    getStatuses: jest.fn().mockResolvedValue({ items: [] }),
    uploadDocument: jest.fn(),
    ...overrides,
  };
}

function Probe({ id }: { id: string }) {
  const connection = useConnectionState();
  const status = useTrackedStatus(id);
  const store = useStatusStore();
  return (
    <div>
      <span data-testid="connection">{connection}</span>
      <span data-testid="status">{status ? `${status.status}:${status.errorCode ?? ''}` : 'sin-seguimiento'}</span>
      <button onClick={() => store.track(id)}>seguir</button>
    </div>
  );
}

function setup(api: ApiClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiProvider client={api}>
      <StatusEventsProvider eventSourceFactory={(url) => new FakeEventSource(url)}>{children}</StatusEventsProvider>
    </ApiProvider>
  );
  const view = render(<Probe id={ID} />, { wrapper });
  return view;
}

const current = () => FakeEventSource.instances[FakeEventSource.instances.length - 1] as FakeEventSource;

describe('StatusEventsProvider', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('abre una sola conexion contra la URL de eventos de la API', () => {
    setup(fakeApi());

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(current().url).toBe('http://api.test/api/events');
    expect(screen.getByTestId('connection')).toHaveTextContent('connecting');
  });

  it('marca la conexion como abierta y reconcilia los documentos en PROCESANDO (E-44)', async () => {
    const getStatuses = jest.fn().mockResolvedValue({ items: [{ id: ID, status: 'INDEXADO', errorCode: null }] });
    setup(fakeApi({ getStatuses }));
    act(() => screen.getByText('seguir').click());

    await act(async () => current().emit('open'));

    expect(screen.getByTestId('connection')).toHaveTextContent('open');
    expect(getStatuses).toHaveBeenCalledWith([ID]);
    expect(screen.getByTestId('status')).toHaveTextContent('INDEXADO:');
  });

  it('no consulta estados si no hay documentos pendientes', async () => {
    const getStatuses = jest.fn();
    setup(fakeApi({ getStatuses }));

    await act(async () => current().emit('open'));

    expect(getStatuses).not.toHaveBeenCalled();
  });

  it('actualiza el estado seguido con document-status', async () => {
    setup(fakeApi());
    act(() => screen.getByText('seguir').click());

    await act(async () => current().emit('document-status', { documentId: ID, status: 'ERROR', reason: 'PDF_CORRUPT', occurredAt: '2026-09-29T10:00:00Z' }));

    expect(screen.getByTestId('status')).toHaveTextContent('ERROR:PDF_CORRUPT');
  });

  it('aplica un evento que llega antes de empezar a seguir el documento', async () => {
    setup(fakeApi());

    await act(async () => current().emit('document-status', { documentId: ID, status: 'INDEXADO', occurredAt: '2026-09-29T10:00:00Z' }));
    act(() => screen.getByText('seguir').click());

    expect(screen.getByTestId('status')).toHaveTextContent('INDEXADO:');
  });

  it('ignora eventos mal formados y de otros documentos sin fallar', async () => {
    setup(fakeApi());
    act(() => screen.getByText('seguir').click());

    await act(async () => {
      current().emit('document-status', { documentId: 'no-uuid', status: 'INDEXADO', occurredAt: 'x' });
      current().emit('document-status', { documentId: OTHER, status: 'INDEXADO', occurredAt: '2026-09-29T10:00:00Z' });
      current().emit('document-status', { estado: 'raro' });
    });

    expect(screen.getByTestId('status')).toHaveTextContent('PROCESANDO:');
  });

  it('reconcilia ante el evento resync', async () => {
    const getStatuses = jest.fn().mockResolvedValue({ items: [{ id: ID, status: 'ERROR', errorCode: 'WORKER_LOST' }] });
    setup(fakeApi({ getStatuses }));
    act(() => screen.getByText('seguir').click());

    await act(async () => current().emit('resync', { occurredAt: '2026-09-29T10:00:00Z' }));

    expect(getStatuses).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('status')).toHaveTextContent('ERROR:WORKER_LOST');
  });

  it('tolera que la reconciliacion falle y sigue con el estado previo', async () => {
    const getStatuses = jest.fn().mockRejectedValue(new Error('sin red'));
    setup(fakeApi({ getStatuses }));
    act(() => screen.getByText('seguir').click());

    await act(async () => current().emit('open'));

    expect(screen.getByTestId('status')).toHaveTextContent('PROCESANDO:');
  });

  it('con un error recuperable del navegador solo avisa y no abre otra conexion', () => {
    setup(fakeApi());
    current().readyState = 0;

    act(() => current().emit('error'));
    act(() => {
      jest.advanceTimersByTime(RECONNECT_DELAY_MS * 2);
    });

    expect(screen.getByTestId('connection')).toHaveTextContent('closed');
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('reabre la conexion tras un cierre definitivo del navegador', async () => {
    const getStatuses = jest.fn().mockResolvedValue({ items: [] });
    setup(fakeApi({ getStatuses }));
    act(() => screen.getByText('seguir').click());
    const first = current();
    first.readyState = 2;

    act(() => first.emit('error'));
    expect(first.closed).toBe(true);
    act(() => {
      jest.advanceTimersByTime(RECONNECT_DELAY_MS);
    });

    expect(FakeEventSource.instances).toHaveLength(2);
    await act(async () => current().emit('open'));
    expect(screen.getByTestId('connection')).toHaveTextContent('open');
    expect(getStatuses).toHaveBeenCalledWith([ID]);
  });

  it('cierra la conexion y cancela la reconexion al desmontar', () => {
    const { unmount } = setup(fakeApi());
    const first = current();
    first.readyState = 2;
    act(() => first.emit('error'));

    unmount();
    act(() => {
      jest.advanceTimersByTime(RECONNECT_DELAY_MS * 2);
    });

    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
