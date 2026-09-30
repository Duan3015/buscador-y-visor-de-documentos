import type { DocumentStatusEvent, ResyncEvent } from '@kata/shared';

export const STATUS_EVENT_SOURCE = Symbol('StatusEventSource');

export interface StatusEventListener {
  onEvent(event: DocumentStatusEvent): void;
  /** El origen perdio y recupero su conexion: los clientes deben reconciliar (ADR-07). */
  onResync(): void;
}

/** Origen de los cambios de estado (hoy LISTEN/NOTIFY de PostgreSQL). */
export interface StatusEventSource {
  start(listener: StatusEventListener): Promise<void>;
  stop(): Promise<void>;
}

export type ClientMessage =
  | { type: 'document-status'; data: DocumentStatusEvent }
  | { type: 'resync'; data: ResyncEvent };

/** Un cliente conectado. `send` y `ping` lanzan si la conexion ya no es escribible. */
export interface ClientSink {
  send(message: ClientMessage): void;
  ping(): void;
}
