export interface PgErrorInfo {
  code: string;
  constraint?: string;
}

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  '57P01',
  '57P02',
  '57P03',
  '53300',
]);

const MAX_CAUSE_DEPTH = 5;

/** Drizzle envuelve los errores del driver en `cause`: se recorre la cadena hasta encontrar el codigo. */
export function findPgError(error: unknown): PgErrorInfo | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth += 1) {
    if (typeof current === 'object' && current !== null) {
      const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
      if (typeof candidate.code === 'string') {
        return {
          code: candidate.code,
          constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
        };
      }
      current = candidate.cause;
    } else {
      return null;
    }
  }
  return null;
}

/** Errores de conectividad o de capacidad del servidor: se traducen a 503, no a 500 (E-47). */
export function isConnectionError(error: unknown): boolean {
  const info = findPgError(error);
  if (!info) return false;
  return CONNECTION_ERROR_CODES.has(info.code) || info.code.startsWith('08');
}

export const UNIQUE_VIOLATION = '23505';
/** program_limit_exceeded: se produce cuando el tsvector supera el limite de tamano (E-34). */
export const PROGRAM_LIMIT_EXCEEDED = '54000';
