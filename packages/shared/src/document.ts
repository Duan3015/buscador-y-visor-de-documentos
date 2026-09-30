export const DOCUMENT_STATUSES = ['PROCESANDO', 'INDEXADO', 'ERROR'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_FORMATS = ['TXT', 'MARKDOWN', 'PDF'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/** Codigos de la causa de un documento en ERROR (catalogo de ADR-08). */
export const DOCUMENT_ERROR_CODES = [
  'NO_EXTRACTABLE_TEXT',
  'PDF_CORRUPT',
  'PDF_ENCRYPTED',
  'ENCODING_UNSUPPORTED',
  'TEXT_TOO_LARGE',
  'PDF_TOO_MANY_PAGES',
  'INDEX_LIMIT_EXCEEDED',
  'EXTRACTION_TIMEOUT',
  'PROCESSING_FAILED',
  'WORKER_LOST',
] as const;
export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

/**
 * Codigos estables de la API (ADR-11). NOT_FOUND cubre las rutas inexistentes,
 * que no pertenecen a ningun documento.
 */
export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'FILE_REQUIRED',
  'EMPTY_FILE',
  'INVALID_QUERY',
  'DOCUMENT_NOT_FOUND',
  'NOT_FOUND',
  'DUPLICATE_DOCUMENT',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'SERVICE_UNAVAILABLE',
  'TOO_MANY_CONNECTIONS',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
