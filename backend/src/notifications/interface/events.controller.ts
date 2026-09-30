import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TooManyConnectionsError } from '../../shared-kernel/errors';
import { EventHub } from '../application/event-hub';
import type { ClientMessage, ClientSink } from '../domain/ports';

/** Milisegundos que el navegador espera antes de reconectar (campo `retry` de SSE). */
const CLIENT_RETRY_MS = 3000;
const RETRY_AFTER_SECONDS = '5';

function frame(message: ClientMessage): string {
  return `event: ${message.type}\ndata: ${JSON.stringify(message.data)}\n\n`;
}

/** Canal SSE global (HU-04, ADR-07): un flujo por pestana con todos los cambios de estado. */
@Controller('events')
export class EventsController {
  constructor(@Inject(EventHub) private readonly hub: EventHub) {}

  @Get()
  stream(@Req() req: Request, @Res() res: Response): void {
    const write = (chunk: string): void => {
      if (res.writableEnded || res.destroyed) throw new Error('La conexion del cliente esta cerrada');
      res.write(chunk);
    };
    const sink: ClientSink = {
      send: (message) => write(frame(message)),
      ping: () => write(': keepalive\n\n'),
    };

    let release: () => void;
    try {
      release = this.hub.subscribe(sink);
    } catch (error) {
      if (error instanceof TooManyConnectionsError) res.setHeader('Retry-After', RETRY_AFTER_SECONDS);
      throw error;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`retry: ${CLIENT_RETRY_MS}\n\n`);

    req.on('close', release);
    res.on('error', release);
  }
}
