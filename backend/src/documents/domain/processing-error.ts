import type { DocumentErrorCode } from '@kata/shared';

const MAX_DETAIL_LENGTH = 500;

/**
 * Fallo del procesamiento de un documento. Un fallo permanente marca ERROR de inmediato;
 * uno transitorio se relanza para que la cola reintente (ADR-08).
 */
export class DocumentProcessingError extends Error {
  constructor(
    readonly code: DocumentErrorCode,
    readonly permanent: boolean,
    detail: string,
    override readonly cause?: unknown,
  ) {
    super(detail);
    this.name = 'DocumentProcessingError';
  }

  /** Detalle tecnico acotado, sin rutas ni trazas (ADR-08). */
  get safeDetail(): string {
    return truncateDetail(this.message);
  }
}

export function truncateDetail(detail: string): string {
  return detail.length > MAX_DETAIL_LENGTH ? detail.slice(0, MAX_DETAIL_LENGTH) : detail;
}

export const permanentFailure = (code: DocumentErrorCode, detail: string): DocumentProcessingError =>
  new DocumentProcessingError(code, true, detail);

export const transientFailure = (
  code: DocumentErrorCode,
  detail: string,
  cause?: unknown,
): DocumentProcessingError => new DocumentProcessingError(code, false, detail, cause);

/** El vector de busqueda supero el limite de PostgreSQL (E-34, ADR-03). */
export class IndexLimitError extends Error {
  constructor() {
    super('El vector de busqueda supera el limite permitido');
    this.name = 'IndexLimitError';
  }
}

/** Violacion de unicidad de la huella SHA-256 (E-33, ADR-06). */
export class DuplicateFingerprintError extends Error {
  constructor() {
    super('Ya existe un documento con la misma huella');
    this.name = 'DuplicateFingerprintError';
  }
}
