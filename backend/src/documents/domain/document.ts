import type { DocumentFormat, DocumentStatus } from '@kata/shared';

export interface DocumentMetadata {
  title: string;
  author: string;
  category: string;
  tags: string[];
  version: string | null;
}

export interface DocumentProps extends DocumentMetadata {
  id: string;
  format: DocumentFormat;
  originalFilename: string;
  sizeBytes: number;
  fileSha256: string;
  status: DocumentStatus;
  createdAt: Date;
}

export interface CreateDocumentInput extends DocumentMetadata {
  id: string;
  format: DocumentFormat;
  originalFilename: string;
  sizeBytes: number;
  fileSha256: string;
  createdAt: Date;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_FILENAME_LENGTH = 255;

/** Error de invariante: indica un defecto del llamador, no una entrada del usuario. */
export class DocumentInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentInvariantError';
  }
}

/**
 * Deja solo el nombre base, sin rutas ni caracteres de control (E-06).
 * El nombre solo se guarda como metadato: el archivo se almacena con el identificador generado.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = Array.from(base)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f && !'<>:"|?*'.includes(char);
    })
    .join('')
    .trim()
    .replace(/^\.+/, '');
  const limited = cleaned.slice(0, MAX_FILENAME_LENGTH);
  return limited === '' ? 'sin-nombre' : limited;
}

/** Transiciones validas del ciclo de vida (E-14, ADR-08). */
const ALLOWED_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  PROCESANDO: ['INDEXADO', 'ERROR'],
  INDEXADO: [],
  ERROR: [],
};

export function canTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertCanTransition(from: DocumentStatus, to: DocumentStatus): void {
  if (!canTransition(from, to)) {
    throw new DocumentInvariantError(`Transicion invalida: ${from} -> ${to}`);
  }
}

export class Document {
  private constructor(readonly props: DocumentProps) {}

  /** Fabrica: garantiza el estado inicial y las invariantes de creacion. */
  static create(input: CreateDocumentInput): Document {
    if (!SHA256_PATTERN.test(input.fileSha256)) {
      throw new DocumentInvariantError('La huella SHA-256 debe ser hexadecimal en minusculas de 64 caracteres');
    }
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new DocumentInvariantError('El tamano del archivo debe ser mayor que cero');
    }
    if (input.id.trim() === '') {
      throw new DocumentInvariantError('El documento requiere un identificador');
    }
    return new Document({
      ...input,
      tags: [...input.tags],
      originalFilename: sanitizeFilename(input.originalFilename),
      status: 'PROCESANDO',
    });
  }

  get id(): string {
    return this.props.id;
  }

  get status(): DocumentStatus {
    return this.props.status;
  }
}
