import type { ApiErrorCode, DocumentStatus, FieldError } from '@kata/shared';

/**
 * Error de dominio o de aplicacion con un codigo estable (ADR-11, ADR-14).
 * No conoce HTTP: la capa de interfaz traduce el codigo a un estado.
 */
export class DomainError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly extra: { errors?: FieldError[]; existing?: { id: string; status: DocumentStatus } } = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationFailedError extends DomainError {
  constructor(errors: FieldError[], message = 'Los datos enviados no son validos') {
    super('VALIDATION_FAILED', message, { errors });
  }
}

export class InvalidQueryError extends DomainError {
  constructor(errors: FieldError[], message = 'Los parametros de la consulta no son validos') {
    super('INVALID_QUERY', message, { errors });
  }
}

export class FileRequiredError extends DomainError {
  constructor() {
    super('FILE_REQUIRED', 'Debe adjuntar un archivo en el campo "file"');
  }
}

export class EmptyFileError extends DomainError {
  constructor() {
    super('EMPTY_FILE', 'El archivo esta vacio');
  }
}

export class FileTooLargeError extends DomainError {
  constructor(readonly limitBytes: number) {
    super('FILE_TOO_LARGE', `El archivo supera el tamano maximo permitido de ${limitBytes} bytes`);
  }
}

export class UnsupportedMediaTypeError extends DomainError {
  constructor(message = 'El contenido del archivo no corresponde a un formato admitido (TXT, Markdown o PDF)') {
    super('UNSUPPORTED_MEDIA_TYPE', message);
  }
}

export class DuplicateDocumentError extends DomainError {
  constructor(existing: { id: string; status: DocumentStatus }) {
    super('DUPLICATE_DOCUMENT', 'Ya existe un documento con el mismo contenido', { existing });
  }
}

export class DocumentNotFoundError extends DomainError {
  constructor() {
    super('DOCUMENT_NOT_FOUND', 'El documento no existe');
  }
}

export class ServiceUnavailableError extends DomainError {
  constructor(message = 'El servicio no esta disponible temporalmente. Intente de nuevo en unos segundos') {
    super('SERVICE_UNAVAILABLE', message);
  }
}

export class TooManyConnectionsError extends DomainError {
  constructor() {
    super('TOO_MANY_CONNECTIONS', 'Se alcanzo el maximo de conexiones de eventos');
  }
}
