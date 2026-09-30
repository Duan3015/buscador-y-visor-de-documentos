import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { toProblem } from './problem-details';
import { resolveTraceId, type TracedRequest } from './trace-id';

/** Filtro global unico (ADR-14): todo error sale con el formato Problem Details. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<TracedRequest>();
    const res = http.getResponse<Response>();
    const traceId = req.traceId ?? resolveTraceId(undefined);

    const problem = toProblem(error, traceId);
    if (problem.unexpected) {
      const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error(`traceId=${traceId} ${req.method} ${req.originalUrl} ${stack}`);
    }

    if (res.headersSent) {
      // Una respuesta en curso (por ejemplo SSE) no admite un cuerpo de error: se cierra.
      res.end();
      return;
    }
    res.status(problem.status).type('application/problem+json').setHeader('X-Request-Id', traceId);
    res.send(JSON.stringify(problem.body));
  }
}
