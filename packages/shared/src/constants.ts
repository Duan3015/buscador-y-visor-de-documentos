/** Tamano de pagina fijo de la busqueda (ADR-03, ADR-11). No es un parametro de la API. */
export const PAGE_SIZE = 10;

/** Pagina maxima de la busqueda: 500 resultados por consulta (ADR-11). */
export const MAX_SEARCH_PAGE = 50;

/** Maximo de identificadores en la reconciliacion de estados (ADR-11). */
export const MAX_IDS_PER_REQUEST = 50;

export const SEARCH_QUERY_MIN_LENGTH = 1;
export const SEARCH_QUERY_MAX_LENGTH = 200;

export const METADATA_LIMITS = {
  title: { min: 1, max: 200 },
  author: { min: 1, max: 100 },
  category: { min: 1, max: 50 },
  tag: { min: 1, max: 30 },
  maxTags: 10,
} as const;

/** Formato de version admitido: 1, 1.2 o 1.2.3 (ADR-11). */
export const VERSION_PATTERN = /^\d+(\.\d+){0,2}$/;

/** Delimitadores de uso privado que marcan las coincidencias resaltadas (ADR-11). */
export const HIGHLIGHT_START = '\uE000';
export const HIGHLIGHT_END = '\uE001';

/** Extensiones admitidas por formato (ADR-10). */
export const FORMAT_EXTENSIONS = {
  TXT: ['.txt'],
  MARKDOWN: ['.md', '.markdown'],
  PDF: ['.pdf'],
} as const;
