import { EventEmitter } from 'node:events';
import type { Client } from 'pg';
import type { DocumentStatusEvent } from '@kata/shared';
import type { StatusEventListener } from '../domain/ports';
import { PgListenEventSource } from './pg-listen-event-source';

class FakeClient extends EventEmitter {
  queries: string[] = [];
  ended = false;
  constructor(private readonly failConnect = false) {
    super();
  }

  async connect(): Promise<void> {
    if (this.failConnect) throw new Error('conexion rechazada');
  }

  async query(text: string): Promise<void> {
    this.queries.push(text);
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

class RecordingListener implements StatusEventListener {
  events: DocumentStatusEvent[] = [];
  resyncs = 0;
  onEvent(event: DocumentStatusEvent): void {
    this.events.push(event);
  }
  onResync(): void {
    this.resyncs += 1;
  }
}

const validEvent: DocumentStatusEvent = {
  documentId: '00000000-0000-4000-8000-000000000001',
  status: 'ERROR',
  reason: 'PDF_CORRUPT',
  occurredAt: '2026-09-29T12:00:00.000Z',
};

async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Tiempo agotado');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function build(clients: FakeClient[]) {
  const warnings: string[] = [];
  let index = 0;
  const source = new PgListenEventSource(
    'postgres://x',
    { warn: (m) => warnings.push(m), error: (m) => warnings.push(m) },
    [5, 5],
    () => {
      const client = clients[Math.min(index, clients.length - 1)];
      index += 1;
      return client as unknown as Client;
    },
  );
  const listener = new RecordingListener();
  return { source, listener, warnings, created: () => index };
}

describe('PgListenEventSource (ADR-07)', () => {
  it('escucha el canal y entrega los eventos validos', async () => {
    const client = new FakeClient();
    const { source, listener } = build([client]);

    await source.start(listener);
    client.emit('notification', { payload: JSON.stringify(validEvent) });

    expect(client.queries).toEqual(['LISTEN document_status']);
    expect(listener.events).toEqual([validEvent]);
    expect(listener.resyncs).toBe(0);
    await source.stop();
  });

  it.each([
    ['sin contenido', undefined],
    ['que no es JSON', 'no-json'],
    ['con formato invalido', JSON.stringify({ documentId: 'x', status: 'OTRO' })],
  ])('descarta una notificacion %s sin lanzar', async (_name, payload) => {
    const client = new FakeClient();
    const { source, listener } = build([client]);
    await source.start(listener);

    client.emit('notification', { payload });

    expect(listener.events).toEqual([]);
    await source.stop();
  });

  it('reabre la conexion perdida y avisa con resincronizacion (E-26)', async () => {
    const first = new FakeClient();
    const second = new FakeClient();
    const { source, listener } = build([first, second]);
    await source.start(listener);

    first.emit('error', new Error('conexion perdida'));
    await until(() => listener.resyncs === 1);

    expect(second.queries).toEqual(['LISTEN document_status']);
    second.emit('notification', { payload: JSON.stringify(validEvent) });
    expect(listener.events).toEqual([validEvent]);
    await source.stop();
  });

  it('reintenta si la conexion inicial falla y resincroniza al lograrlo', async () => {
    const failing = new FakeClient(true);
    const working = new FakeClient();
    const { source, listener, warnings } = build([failing, working]);

    await expect(source.start(listener)).resolves.toBeUndefined();
    await until(() => listener.resyncs === 1);

    expect(warnings.some((w) => w.includes('No se pudo abrir'))).toBe(true);
    expect(working.queries).toEqual(['LISTEN document_status']);
    await source.stop();
  });

  it('ignora la perdida de una conexion que ya fue descartada', async () => {
    const first = new FakeClient();
    const second = new FakeClient();
    const { source, listener, created } = build([first, second]);
    await source.start(listener);

    first.emit('error', new Error('uno'));
    await until(() => listener.resyncs === 1);
    first.emit('end');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(created()).toBe(2);
    await source.stop();
  });

  it('no reconecta despues de detenerse', async () => {
    const first = new FakeClient();
    const { source, listener, created } = build([first, new FakeClient()]);
    await source.start(listener);

    await source.stop();
    first.emit('error', new Error('cierre'));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(first.ended).toBe(true);
    expect(created()).toBe(1);
  });
});
