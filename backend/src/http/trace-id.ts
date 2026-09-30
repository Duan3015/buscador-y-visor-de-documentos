import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const TRACE_HEADER = 'x-request-id';
const VALID_TRACE_ID = /^[A-Za-z0-9-]{8,64}$/;

export type TracedRequest = Request & { traceId?: string };

/** Acepta la cabecera del cliente solo si cumple el formato; si no, genera un identificador propio (E-48). */
export function resolveTraceId(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate !== undefined && VALID_TRACE_ID.test(candidate) ? candidate : randomUUID();
}

export function traceIdMiddleware(req: TracedRequest, res: Response, next: NextFunction): void {
  const traceId = resolveTraceId(req.headers[TRACE_HEADER]);
  req.traceId = traceId;
  res.setHeader('X-Request-Id', traceId);
  next();
}
