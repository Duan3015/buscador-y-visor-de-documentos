import type { DocumentStatusEvent } from '@kata/shared';
import type { Clock } from '../../shared-kernel/clock';
import { TooManyConnectionsError } from '../../shared-kernel/errors';
import type { ClientSink, StatusEventListener } from '../domain/ports';

export interface EventHubOptions {
  maxClients: number;
  heartbeatMs: number;
}

export interface HubLogger {
  warn(message: string): void;
}

const NOOP_LOGGER: HubLogger = { warn: () => undefined };

/**
 * Difunde los cambios de estado a los clientes conectados (HU-04). Un cliente cuya escritura
 * falla se libera; un latido periodico detecta las conexiones muertas (E-28). El numero de
 * clientes tiene un tope por instancia.
 */
export class EventHub implements StatusEventListener {
  private readonly sinks = new Set<ClientSink>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: EventHubOptions,
    private readonly clock: Clock,
    private readonly logger: HubLogger = NOOP_LOGGER,
  ) {}

  get clientCount(): number {
    return this.sinks.size;
  }

  /** Registra un cliente. Devuelve la funcion que lo libera; es idempotente. */
  subscribe(sink: ClientSink): () => void {
    if (this.sinks.size >= this.options.maxClients) throw new TooManyConnectionsError();
    this.sinks.add(sink);
    this.startHeartbeat();
    return () => this.release(sink);
  }

  onEvent(event: DocumentStatusEvent): void {
    this.broadcast((sink) => sink.send({ type: 'document-status', data: event }));
  }

  onResync(): void {
    const occurredAt = this.clock.now().toISOString();
    this.broadcast((sink) => sink.send({ type: 'resync', data: { occurredAt } }));
  }

  shutdown(): void {
    this.sinks.clear();
    this.stopHeartbeat();
  }

  private broadcast(deliver: (sink: ClientSink) => void): void {
    for (const sink of [...this.sinks]) {
      try {
        deliver(sink);
      } catch (error) {
        this.logger.warn(`Cliente SSE liberado tras un fallo de escritura: ${error instanceof Error ? error.message : String(error)}`);
        this.release(sink);
      }
    }
  }

  private release(sink: ClientSink): void {
    this.sinks.delete(sink);
    if (this.sinks.size === 0) this.stopHeartbeat();
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => this.broadcast((sink) => sink.ping()), this.options.heartbeatMs);
    // El temporizador no debe impedir que el proceso termine.
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
