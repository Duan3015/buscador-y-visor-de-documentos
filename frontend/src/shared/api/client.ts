import {
  documentAcceptedSchema,
  documentDetailSchema,
  documentStatusListSchema,
  problemDetailsSchema,
  searchResponseSchema,
  type DocumentAccepted,
  type DocumentDetail,
  type DocumentStatusList,
  type ProblemDetails,
  type SearchResponse,
  type UploadMetadata,
} from '@kata/shared';

/** Parte de la interfaz de un esquema Zod que usa el cliente (evita depender de Zod directamente). */
interface ResponseSchema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

/** Codigos propios del cliente para fallos que no vienen del servidor. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'UNKNOWN_ERROR';

/** Error de la API o del transporte, con el codigo estable que usa la interfaz para traducirlo. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly problem?: ProblemDetails,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface UploadInput {
  file: File;
  metadata: UploadMetadata;
}

/** Contrato que consumen las pantallas. Permite sustituir la red por un doble en las pruebas. */
export interface ApiClient {
  readonly eventsUrl: string;
  searchDocuments(query: { q: string; page: number }, signal?: AbortSignal): Promise<SearchResponse>;
  getDocument(id: string, signal?: AbortSignal): Promise<DocumentDetail>;
  getStatuses(ids: string[], signal?: AbortSignal): Promise<DocumentStatusList>;
  uploadDocument(input: UploadInput, signal?: AbortSignal): Promise<DocumentAccepted>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function readProblem(response: Response): Promise<ProblemDetails | undefined> {
  try {
    const parsed = problemDetailsSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Cliente HTTP tipado: valida cada respuesta con los esquemas de `@kata/shared`. */
export function createApiClient(baseUrl: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)): ApiClient {
  const root = baseUrl.replace(/\/+$/, '');

  async function send<T>(path: string, schema: ResponseSchema<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${root}${path}`, init);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor');
    }

    if (!response.ok) {
      const problem = await readProblem(response);
      throw new ApiError(
        response.status,
        problem?.code ?? 'UNKNOWN_ERROR',
        problem?.detail ?? `Respuesta inesperada del servidor (${response.status})`,
        problem,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'El servidor devolvio una respuesta ilegible');
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'El servidor devolvio una respuesta con formato inesperado');
    }
    return parsed.data;
  }

  return {
    eventsUrl: `${root}/events`,

    searchDocuments({ q, page }, signal) {
      const params = new URLSearchParams({ q, page: String(page) });
      return send(`/search?${params.toString()}`, searchResponseSchema, { signal });
    },

    getDocument(id, signal) {
      return send(`/documents/${encodeURIComponent(id)}`, documentDetailSchema, { signal });
    },

    getStatuses(ids, signal) {
      const params = new URLSearchParams({ ids: ids.join(',') });
      return send(`/documents?${params.toString()}`, documentStatusListSchema, { signal });
    },

    uploadDocument({ file, metadata }, signal) {
      const form = new FormData();
      form.append('title', metadata.title);
      form.append('author', metadata.author);
      form.append('category', metadata.category);
      for (const tag of metadata.tags) form.append('tags', tag);
      if (metadata.version) form.append('version', metadata.version);
      form.append('file', file, file.name);
      return send('/documents', documentAcceptedSchema, { method: 'POST', body: form, signal });
    },
  };
}
