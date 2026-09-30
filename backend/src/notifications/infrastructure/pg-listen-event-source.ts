import { documentStatusEventSchema } from '@kata/shared';
import { Client } from 'pg';
import { STATUS_CHANNEL } from '../../shared-kernel/channels';
import type { StatusEventListener, StatusEventSource } from '../domain/ports';

export interface ListenLogger {
  warn(message: string): void;
  error(message: string): void;
}

const NOOP_LOGGER: ListenLogger = { warn: () => undefined, error: () => undefined };

/** Espera creciente entre intentos de reconexion, con tope. */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000];

export interface ClientFactory {
  create(): Client;
}

/**
 * LISTEN/NOTIFY con una conexion dedicada, fuera del pool (ADR-07). Si la conexion se pierde, la
 * reabre con reintentos y, al restablecerla, avisa con `onResync` porque pudo perderse algun evento.
 */
export class PgListenEventSource implements StatusEventSource {
  private listener: StatusEventListener | null = null;
  private client: Client | null = null;
  private stopped = true;
  private retryTimer: NodeJS.Timeout | null = null;
  private attempt = 0;

  constructor(
    private readonly databaseUrl: string,
    private readonly logger: ListenLogger = NOOP_LOGGER,
    private readonly delaysMs: readonly number[] = RECONNECT_DELAYS_MS,
    private readonly createClient: () => Client = () =>
      new Client({ connectionString: databaseUrl, keepAlive: true, application_name: 'kata-listener' }),
  ) {}

  async start(listener: StatusEventListener): Promise<void> {
    this.listener = listener;
    this.stopped = false;
    await this.connect(false);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => undefined);
  }

  private async connect(isReconnection: boolean): Promise<void> {
    const client = this.createClient();
    client.on('error', (error) => this.onConnectionLost(client, error));
    client.on('end', () => this.onConnectionLost(client));
    client.on('notification', (message) => this.onNotification(message.payload));

    try {
      await client.connect();
      await client.query(`LISTEN ${STATUS_CHANNEL}`);
    } catch (error) {
      await client.end().catch(() => undefined);
      this.logger.warn(`No se pudo abrir el escuchador de estados: ${error instanceof Error ? error.message : String(error)}`);
      this.scheduleRetry();
      return;
    }

    if (this.stopped) {
      await client.end().catch(() => undefined);
      return;
    }
    this.client = client;
    this.attempt = 0;
    if (isReconnection) this.listener?.onResync();
  }

  private onConnectionLost(client: Client, error?: Error): void {
    // Solo importa la perdida de la conexion vigente; las de conexiones ya descartadas se ignoran.
    if (this.stopped || client !== this.client) return;
    this.client = null;
    this.logger.warn(`Se perdio la conexion del escuchador de estados${error ? `: ${error.message}` : ''}`);
    void client.end().catch(() => undefined);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    const delay = this.delaysMs[Math.min(this.attempt, this.delaysMs.length - 1)] ?? 1_000;
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect(true);
    }, delay);
    this.retryTimer.unref();
  }

  private onNotification(payload: string | undefined): void {
    if (!payload || !this.listener) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      this.logger.warn('Se descarto una notificacion que no es JSON');
      return;
    }
    const event = documentStatusEventSchema.safeParse(parsed);
    if (!event.success) {
      this.logger.warn('Se descarto una notificacion con formato invalido');
      return;
    }
    this.listener.onEvent(event.data);
  }
}
