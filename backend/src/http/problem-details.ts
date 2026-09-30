import { toFieldErrors, type ApiErrorCode, type FieldError, type ProblemDetails } from '@kata/shared';
import { ZodError } from 'zod';
import { isConnectionError } from '../documents/infrastructure/pg-errors';
import { DomainError } from '../shared-kernel/errors';

export const CODE_TO_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  FILE_REQUIRED: 400,
  EMPTY_FILE: 400,
  INVALID_QUERY: 400,
  DOCUMENT_NOT_FOUND: 404,
  NOT_FOUND: 404,
  DUPLICATE_DOCUMENT: 409,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  SERVICE_UNAVAILABLE: 503,
  TOO_MANY_CONNECTIONS: 503,
  INTERNAL_ERROR: 500,
};

const TITLES: Record<number, string> = {
  400: 'Solicitud invalida',
  404: 'No encontrado',
  409: 'Conflicto',
  413: 'Archivo demasiado grande',
  415: 'Formato no admitido',
  500: 'Error interno',
  503: 'Servicio no disponible',
};

const MULTER_LIMIT_CODES_AS_TOO_LARGE = new Set(['LIMIT_FILE_SIZE']);

export interface ProblemResult {
  status: number;
  body: ProblemDetails;
  /** Verdadero si es un fallo no previsto que debe registrarse con su traza. */
  unexpected: boolean;
}

interface HttpLikeError {
  status?: unknown;
  statusCode?: unknown;
  getStatus?: () => number;
}

function build(code: ApiErrorCode, detail: string, traceId: string, extra: Partial<ProblemDetails> = {}): ProblemResult {
  const status = CODE_TO_STATUS[code];
  return {
    status,
    unexpected: code === 'INTERNAL_ERROR',
    body: { status, title: TITLES[status] ?? 'Error', detail, code, traceId, ...extra },
  };
}

function httpStatusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as HttpLikeError;
  if (typeof candidate.getStatus === 'function') return candidate.getStatus();
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  return null;
}

function isMulterError(error: unknown): error is { name: string; code: string; field?: string; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'MulterError' &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

/**
 * Traduce cualquier error al formato Problem Details de ADR-11 (E-47, E-48).
 * Un error no previsto nunca expone su mensaje ni su traza.
 */
export function toProblem(error: unknown, traceId: string): ProblemResult {
  if (error instanceof DomainError) {
    const extra: Partial<ProblemDetails> = {};
    if (error.extra.errors) extra.errors = error.extra.errors;
    if (error.extra.existing) extra.existing = error.extra.existing;
    return build(error.code, error.message, traceId, extra);
  }

  if (error instanceof ZodError) {
    return build('VALIDATION_FAILED', 'Los datos enviados no son validos', traceId, {
      errors: toFieldErrors(error),
    });
  }

  if (isMulterError(error)) {
    if (MULTER_LIMIT_CODES_AS_TOO_LARGE.has(error.code)) {
      return build('FILE_TOO_LARGE', 'El archivo supera el tamano maximo permitido', traceId);
    }
    const errors: FieldError[] = [{ field: error.field ?? 'file', message: 'Campo o archivo no permitido' }];
    return build('VALIDATION_FAILED', 'La solicitud multipart no es valida', traceId, { errors });
  }

  if (isConnectionError(error)) {
    return build('SERVICE_UNAVAILABLE', 'El servicio no esta disponible temporalmente. Intente de nuevo en unos segundos', traceId);
  }

  const status = httpStatusOf(error);
  if (status !== null && status >= 400 && status < 500) {
    if (status === 404) return build('NOT_FOUND', 'La ruta solicitada no existe', traceId);
    if (status === 413) return build('FILE_TOO_LARGE', 'La solicitud supera el tamano maximo permitido', traceId);
    if (status === 415) return build('UNSUPPORTED_MEDIA_TYPE', 'El tipo de contenido no es admitido', traceId);
    return build('VALIDATION_FAILED', 'La solicitud no es valida', traceId);
  }

  return build('INTERNAL_ERROR', 'Ocurrio un error inesperado. Indique el identificador de traza al soporte', traceId);
}
