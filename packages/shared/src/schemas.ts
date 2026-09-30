import { z } from 'zod';
import {
  MAX_IDS_PER_REQUEST,
  MAX_SEARCH_PAGE,
  METADATA_LIMITS,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  VERSION_PATTERN,
} from './constants';
import { DOCUMENT_ERROR_CODES, DOCUMENT_FORMATS, DOCUMENT_STATUSES } from './document';

const boundedText = (label: string, min: number, max: number) =>
  z
    .string({ error: `${label} es obligatorio` })
    .trim()
    .min(min, `${label} es obligatorio`)
    .max(max, `${label} no puede superar ${max} caracteres`);

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const toArray = (value: unknown) => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const tagsSchema = z.preprocess(
  toArray,
  z
    .array(boundedText('Cada etiqueta', METADATA_LIMITS.tag.min, METADATA_LIMITS.tag.max))
    .max(METADATA_LIMITS.maxTags, `Se admiten hasta ${METADATA_LIMITS.maxTags} etiquetas`)
    .refine(
      (tags) => new Set(tags.map((tag) => tag.toLowerCase())).size === tags.length,
      'Las etiquetas no pueden repetirse',
    ),
);

/** Metadatos de la carga (HU-01, ADR-11). Un campo desconocido se rechaza. */
export const uploadMetadataSchema = z
  .object({
    title: boundedText('El titulo', METADATA_LIMITS.title.min, METADATA_LIMITS.title.max),
    author: boundedText('El autor', METADATA_LIMITS.author.min, METADATA_LIMITS.author.max),
    category: boundedText(
      'La categoria',
      METADATA_LIMITS.category.min,
      METADATA_LIMITS.category.max,
    ),
    tags: tagsSchema.default([]),
    version: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .regex(VERSION_PATTERN, 'La version debe tener el formato 1, 1.2 o 1.2.3')
        .optional(),
    ),
  })
  .strict();
export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;

/** Parametros de la busqueda (HU-02, ADR-11). El tamano de pagina es fijo. */
export const searchQuerySchema = z
  .object({
    q: z
      .string({ error: 'La consulta es obligatoria' })
      .trim()
      .min(SEARCH_QUERY_MIN_LENGTH, 'La consulta no puede estar vacia')
      .max(SEARCH_QUERY_MAX_LENGTH, `La consulta no puede superar ${SEARCH_QUERY_MAX_LENGTH} caracteres`)
      // PostgreSQL rechaza el caracter nulo en el texto: se descarta antes de llegar a la base de datos.
      .refine((value) => !value.includes('\u0000'), 'La consulta contiene caracteres no validos'),
    page: z.coerce
      .number({ error: 'La pagina debe ser un numero' })
      .int('La pagina debe ser un entero')
      .min(1, 'La pagina minima es 1')
      .max(MAX_SEARCH_PAGE, `La pagina maxima es ${MAX_SEARCH_PAGE}`)
      .default(1),
  })
  .strict();
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Identificadores para la reconciliacion de estados (ADR-07, ADR-11). */
export const idsQuerySchema = z
  .object({
    ids: z
      .string({ error: 'ids es obligatorio' })
      .transform((value) => value.split(',').map((id) => id.trim()).filter((id) => id !== ''))
      .pipe(
        z
          .array(z.uuid('Cada identificador debe ser un UUID'))
          .min(1, 'Se requiere al menos un identificador')
          .max(MAX_IDS_PER_REQUEST, `Se admiten hasta ${MAX_IDS_PER_REQUEST} identificadores`),
      )
      .transform((ids) => Array.from(new Set(ids))),
  })
  .strict();
export type IdsQuery = z.infer<typeof idsQuerySchema>;

const statusSchema = z.enum(DOCUMENT_STATUSES);
const errorCodeSchema = z.enum(DOCUMENT_ERROR_CODES);
const formatSchema = z.enum(DOCUMENT_FORMATS);

export const documentAcceptedSchema = z.object({
  id: z.uuid(),
  status: z.literal('PROCESANDO'),
});
export type DocumentAccepted = z.infer<typeof documentAcceptedSchema>;

export const documentStatusItemSchema = z.object({
  id: z.uuid(),
  status: statusSchema,
  errorCode: errorCodeSchema.nullable(),
});
export type DocumentStatusItem = z.infer<typeof documentStatusItemSchema>;

export const documentStatusListSchema = z.object({
  items: z.array(documentStatusItemSchema),
});
export type DocumentStatusList = z.infer<typeof documentStatusListSchema>;

export const documentDetailSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  author: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  version: z.string().nullable(),
  format: formatSchema,
  originalFilename: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  status: statusSchema,
  error: z
    .object({ code: errorCodeSchema, attempts: z.number().int().nonnegative() })
    .nullable(),
  createdAt: z.string(),
  indexedAt: z.string().nullable(),
  content: z.string().nullable(),
  totalChars: z.number().int().nonnegative().nullable(),
  indexedChars: z.number().int().nonnegative().nullable(),
  isPartiallyIndexed: z.boolean().nullable(),
});
export type DocumentDetail = z.infer<typeof documentDetailSchema>;

export const searchResultItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  author: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  version: z.string().nullable(),
  /** Fragmentos con delimitadores de resaltado; ver parseHighlight. */
  fragments: z.array(z.string()),
});
export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const searchResponseSchema = z.object({
  items: z.array(searchResultItemSchema),
  page: z.number().int().min(1),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const fieldErrorSchema = z.object({ field: z.string(), message: z.string() });
export type FieldError = z.infer<typeof fieldErrorSchema>;

export const problemDetailsSchema = z.object({
  status: z.number().int(),
  title: z.string(),
  detail: z.string(),
  code: z.string(),
  traceId: z.string(),
  errors: z.array(fieldErrorSchema).optional(),
  existing: z.object({ id: z.uuid(), status: statusSchema }).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const DOCUMENT_STATUS_EVENT = 'document-status';
export const RESYNC_EVENT = 'resync';

export const documentStatusEventSchema = z.object({
  documentId: z.uuid(),
  status: z.enum(['INDEXADO', 'ERROR']),
  reason: errorCodeSchema.optional(),
  occurredAt: z.string(),
});
export type DocumentStatusEvent = z.infer<typeof documentStatusEventSchema>;

export const resyncEventSchema = z.object({ occurredAt: z.string() });
export type ResyncEvent = z.infer<typeof resyncEventSchema>;

/** Convierte los incidentes de Zod en errores por campo (Problem Details, E-03). */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  const result: FieldError[] = [];
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        result.push({ field: key, message: 'Campo no permitido' });
      }
      continue;
    }
    result.push({ field: issue.path.map(String).join('.'), message: issue.message });
  }
  return result;
}
