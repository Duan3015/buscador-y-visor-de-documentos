import type { DocumentStatusEvent } from '@kata/shared';
import { TooManyConnectionsError } from '../../shared-kernel/errors';
import { FixedClock } from '../../documents/testing/fakes';
import type { ClientMessage, ClientSink } from '../domain/ports';
import { EventHub } from './event-hub';

class RecordingSink implements ClientSink {
  messages: ClientMessage[] = [];
  pings = 0;
  broken = false;

  send(message: ClientMessage): void {
    if (this.broken) throw new Error('conexion cerrada');
    this.messages.push(message);
  }

  ping(): void {
    if (this.broken) throw new Error('conexion cerrada');
    this.pings += 1;
  }
}

const event: DocumentStatusEvent = {
  documentId: '00000000-0000-4000-8000-000000000001',
  status: 'INDEXADO',
  occurredAt: '2026-09-29T12:00:00.000Z',
};

function build(maxClients = 3) {
  const warnings: string[] = [];
  const hub = new EventHub({ maxClients, heartbeatMs: 25_000 }, new FixedClock(), { warn: (m) => warnings.push(m) });
  return { hub, warnings };
}

describe('EventHub (HU-04)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('difunde un evento a todos los clientes conectados', () => {
    const { hub } = build();
    const a = new RecordingSink();
    const b = new RecordingSink();
    hub.subscribe(a);
    hub.subscribe(b);

    hub.onEvent(event);

    expect(a.messages).toEqual([{ type: 'document-status', data: event }]);
    expect(b.messages).toEqual([{ type: 'document-status', data: event }]);
    hub.shutdown();
  });

  it('no entrega eventos a un cliente que se desconecto', () => {
    const { hub } = build();
    const sink = new RecordingSink();
    const release = hub.subscribe(sink);
    release();

    hub.onEvent(event);

    expect(sink.messages).toEqual([]);
    expect(hub.clientCount).toBe(0);
  });

  it('liberar dos veces al mismo cliente es inofensivo', () => {
    const { hub } = build();
    const release = hub.subscribe(new RecordingSink());
    release();
    release();
    expect(hub.clientCount).toBe(0);
  });

  it('libera al cliente cuya escritura falla sin afectar a los demas (E-28)', () => {
    const { hub, warnings } = build();
    const broken = new RecordingSink();
    const healthy = new RecordingSink();
    hub.subscribe(broken);
    hub.subscribe(healthy);
    broken.broken = true;

    hub.onEvent(event);

    expect(healthy.messages).toHaveLength(1);
    expect(hub.clientCount).toBe(1);
    expect(warnings).toHaveLength(1);
    hub.shutdown();
  });

  it('rechaza nuevas conexiones al llegar al tope (ADR-07)', () => {
    const { hub } = build(2);
    hub.subscribe(new RecordingSink());
    hub.subscribe(new RecordingSink());
    expect(() => hub.subscribe(new RecordingSink())).toThrow(TooManyConnectionsError);
    hub.shutdown();
  });

  it('libera cupo al desconectarse un cliente', () => {
    const { hub } = build(1);
    const release = hub.subscribe(new RecordingSink());
    release();
    expect(() => hub.subscribe(new RecordingSink())).not.toThrow();
    hub.shutdown();
  });

  it('emite un evento de resincronizacion a todos los clientes', () => {
    const { hub } = build();
    const sink = new RecordingSink();
    hub.subscribe(sink);

    hub.onResync();

    expect(sink.messages).toEqual([{ type: 'resync', data: { occurredAt: '2026-09-29T12:00:00.000Z' } }]);
    hub.shutdown();
  });

  it('envia un latido periodico y detecta conexiones muertas (E-28)', () => {
    jest.useFakeTimers();
    const { hub } = build();
    const healthy = new RecordingSink();
    const dead = new RecordingSink();
    hub.subscribe(healthy);
    hub.subscribe(dead);
    dead.broken = true;

    jest.advanceTimersByTime(25_000);

    expect(healthy.pings).toBe(1);
    expect(hub.clientCount).toBe(1);
    jest.advanceTimersByTime(25_000);
    expect(healthy.pings).toBe(2);
    hub.shutdown();
  });

  it('detiene el latido cuando no quedan clientes', () => {
    jest.useFakeTimers();
    const { hub } = build();
    const sink = new RecordingSink();
    const release = hub.subscribe(sink);
    release();

    jest.advanceTimersByTime(60_000);

    expect(sink.pings).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});
