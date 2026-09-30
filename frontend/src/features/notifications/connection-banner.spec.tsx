import { act, render, screen } from '@testing-library/react';
import { ApiProvider } from '../../shared/api/api-context';
import type { ApiClient } from '../../shared/api/client';
import { ConnectionBanner } from './connection-banner';
import { StatusEventsProvider, type EventSourceLike } from './status-events-provider';

function createSource() {
  const listeners = new Map<string, Array<() => void>>();
  const source: EventSourceLike = {
    readyState: 0,
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener as () => void]);
    },
    close: jest.fn(),
  };
  return { source, emit: (type: string) => (listeners.get(type) ?? []).forEach((listener) => listener()) };
}

const api: ApiClient = {
  eventsUrl: 'http://api.test/api/events',
  searchDocuments: jest.fn(),
  getDocument: jest.fn(),
  getStatuses: jest.fn().mockResolvedValue({ items: [] }),
  uploadDocument: jest.fn(),
};

describe('ConnectionBanner', () => {
  it('solo aparece cuando la conexion en tiempo real se cae (E-44)', async () => {
    const { source, emit } = createSource();
    render(
      <ApiProvider client={api}>
        <StatusEventsProvider eventSourceFactory={() => source}>
          <ConnectionBanner />
        </StatusEventsProvider>
      </ApiProvider>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => emit('open'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => emit('error'));
    expect(screen.getByRole('alert')).toHaveTextContent('Sin actualizaciones en tiempo real');

    await act(async () => emit('open'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
