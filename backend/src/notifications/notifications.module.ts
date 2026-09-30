import { Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { AppConfig } from '../config/env';
import { APP_CONFIG } from '../config/tokens';
import { CLOCK, type Clock } from '../shared-kernel/clock';
import { EventHub } from './application/event-hub';
import { STATUS_EVENT_SOURCE, type StatusEventSource } from './domain/ports';
import { PgListenEventSource } from './infrastructure/pg-listen-event-source';
import { EventsController } from './interface/events.controller';

/** Heartbeat SSE (ADR-07): evita el cierre por inactividad en proxies y detecta conexiones muertas. */
const HEARTBEAT_MS = 25_000;

/** El rol worker no atiende clientes SSE: no necesita escuchar el canal. */
@Injectable()
class NotificationsLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Notifications');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(STATUS_EVENT_SOURCE) private readonly source: StatusEventSource,
    @Inject(EventHub) private readonly hub: EventHub,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.appRole === 'worker') return;
    await this.source.start(this.hub);
    this.logger.log('Escuchando cambios de estado (LISTEN/NOTIFY)');
  }

  async onApplicationShutdown(): Promise<void> {
    this.hub.shutdown();
    await this.source.stop();
  }
}

@Module({
  controllers: [EventsController],
  providers: [
    {
      provide: STATUS_EVENT_SOURCE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const logger = new Logger('PgListen');
        return new PgListenEventSource(config.databaseUrl, {
          warn: (message) => logger.warn(message),
          error: (message) => logger.error(message),
        });
      },
    },
    {
      provide: EventHub,
      inject: [APP_CONFIG, CLOCK],
      useFactory: (config: AppConfig, clock: Clock) => {
        const logger = new Logger('EventHub');
        return new EventHub(
          { maxClients: config.maxSseClients, heartbeatMs: HEARTBEAT_MS },
          clock,
          { warn: (message) => logger.warn(message) },
        );
      },
    },
    NotificationsLifecycle,
  ],
})
export class NotificationsModule {}
