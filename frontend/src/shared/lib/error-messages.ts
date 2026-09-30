import type { DocumentErrorCode } from '@kata/shared';
import { ApiError } from '../api/client';

const GENERIC_API_MESSAGE = 'Ocurrió un error inesperado.';
const GENERIC_DOCUMENT_MESSAGE = 'El documento no se pudo procesar.';

const API_MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: 'Revise los datos del formulario.',
  FILE_REQUIRED: 'Seleccione un archivo.',
  EMPTY_FILE: 'El archivo está vacío.',
  INVALID_QUERY: 'La búsqueda no es válida. Revise el texto y la página.',
  DOCUMENT_NOT_FOUND: 'El documento no existe.',
  NOT_FOUND: 'El recurso solicitado no existe.',
  DUPLICATE_DOCUMENT: 'Este archivo ya fue cargado anteriormente.',
  FILE_TOO_LARGE: 'El archivo supera el tamaño máximo permitido.',
  UNSUPPORTED_MEDIA_TYPE: 'El contenido del archivo no corresponde a un formato admitido (TXT, Markdown o PDF).',
  SERVICE_UNAVAILABLE: 'El servicio no está disponible en este momento. Intente de nuevo en unos segundos.',
  TOO_MANY_CONNECTIONS: 'Hay demasiadas conexiones abiertas. Intente de nuevo en unos segundos.',
  INTERNAL_ERROR: 'Ocurrió un error inesperado en el servidor.',
  NETWORK_ERROR: 'No se pudo conectar con el servidor. Verifique que la API esté en ejecución.',
  INVALID_RESPONSE: 'El servidor devolvió una respuesta que la aplicación no entiende.',
  UNKNOWN_ERROR: GENERIC_API_MESSAGE,
};

const DOCUMENT_ERROR_MESSAGES: Record<DocumentErrorCode, string> = {
  NO_EXTRACTABLE_TEXT: 'El PDF no contiene texto extraíble (probablemente es un documento escaneado).',
  PDF_CORRUPT: 'El PDF está dañado y no se pudo leer.',
  PDF_ENCRYPTED: 'El PDF está protegido con contraseña.',
  ENCODING_UNSUPPORTED: 'El texto no está codificado en UTF-8.',
  TEXT_TOO_LARGE: 'El texto extraído supera el tamaño máximo procesable.',
  PDF_TOO_MANY_PAGES: 'El PDF tiene más páginas de las admitidas.',
  INDEX_LIMIT_EXCEEDED: 'El contenido tiene demasiados términos distintos para indexarse.',
  EXTRACTION_TIMEOUT: 'La lectura del documento tardó demasiado.',
  PROCESSING_FAILED: 'El procesamiento falló después de varios intentos.',
  WORKER_LOST: 'El procesamiento se interrumpió antes de terminar.',
};

/** Mensaje comprensible para un error de la API o del transporte. */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) return API_MESSAGES[error.code] ?? GENERIC_API_MESSAGE;
  return GENERIC_API_MESSAGE;
}

/** Mensaje comprensible para la causa de un documento en estado ERROR. */
export function describeDocumentError(code: string | null | undefined): string {
  if (!code) return GENERIC_DOCUMENT_MESSAGE;
  return DOCUMENT_ERROR_MESSAGES[code as DocumentErrorCode] ?? GENERIC_DOCUMENT_MESSAGE;
}
