import { PAGE_SIZE } from '@kata/shared';
import { z } from 'zod';

export const APP_ROLES = ['api', 'worker', 'all'] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** Tope de caracteres resaltados por solicitud (ADR-03, mediciones 3 y 4). */
export const MAX_HIGHLIGHTED_CHARS_PER_REQUEST = 3_000_000;

const positiveInt = (name: string) =>
  z.coerce.number({ error: `${name} debe ser un numero` }).int(`${name} debe ser entero`).positive(`${name} debe ser mayor que cero`);

const envSchema = z.object({
  APP_ROLE: z.enum(APP_ROLES).default('all'),
  PORT: positiveInt('PORT').max(65535).default(3001),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL es obligatoria' })
    .refine((value) => /^postgres(ql)?:\/\//.test(value), 'DATABASE_URL debe empezar por postgres:// o postgresql://'),
  STORAGE_DIR: z.string().min(1).default('./storage'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  MAX_UPLOAD_BYTES_TEXT: positiveInt('MAX_UPLOAD_BYTES_TEXT').default(3_145_728),
  MAX_UPLOAD_BYTES_PDF: positiveInt('MAX_UPLOAD_BYTES_PDF').default(20_971_520),
  MAX_PDF_PAGES: positiveInt('MAX_PDF_PAGES').default(1000),
  MAX_EXTRACTED_CHARS: positiveInt('MAX_EXTRACTED_CHARS').default(3_000_000),
  MAX_INDEXABLE_CHARS: positiveInt('MAX_INDEXABLE_CHARS').default(300_000),
  MAX_HIGHLIGHT_CHARS: positiveInt('MAX_HIGHLIGHT_CHARS').default(100_000),
  EXTRACTION_TIMEOUT_MS: positiveInt('EXTRACTION_TIMEOUT_MS').default(60_000),
  WORKER_CONCURRENCY: positiveInt('WORKER_CONCURRENCY').default(2),
  JOB_RETRY_LIMIT: z.coerce.number().int().min(0).default(3),
  JOB_RETRY_DELAY_SECONDS: positiveInt('JOB_RETRY_DELAY_SECONDS').default(10),
  MAX_SSE_CLIENTS: positiveInt('MAX_SSE_CLIENTS').default(500),
});

export interface AppConfig {
  appRole: AppRole;
  port: number;
  databaseUrl: string;
  storageDir: string;
  corsOrigin: string;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  maxUploadBytesText: number;
  maxUploadBytesPdf: number;
  maxPdfPages: number;
  maxExtractedChars: number;
  maxIndexableChars: number;
  /** Caracteres iniciales de cada documento sobre los que se resaltan los fragmentos (ADR-03). */
  maxHighlightChars: number;
  extractionTimeoutMs: number;
  workerConcurrency: number;
  jobRetryLimit: number;
  jobRetryDelaySeconds: number;
  maxSseClients: number;
}

/** Error de configuracion: lista los nombres de las variables incorrectas, nunca sus valores (ADR-14). */
export class ConfigError extends Error {
  constructor(readonly invalidVariables: string[], readonly messages: string[]) {
    super(`Configuracion invalida. Variables incorrectas: ${invalidVariables.join(', ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const input: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    // Una variable vacia se trata como ausente para aplicar el valor por defecto.
    input[key] = value === '' ? undefined : value;
  }

  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const names = new Set<string>();
    const messages: string[] = [];
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0] ?? 'DESCONOCIDA');
      names.add(name);
      messages.push(`${name}: ${issue.message}`);
    }
    throw new ConfigError([...names], messages);
  }

  const values = parsed.data;
  const invariantErrors: string[] = [];
  if (PAGE_SIZE * values.MAX_INDEXABLE_CHARS > MAX_HIGHLIGHTED_CHARS_PER_REQUEST) {
    invariantErrors.push(
      `MAX_INDEXABLE_CHARS: PAGE_SIZE x MAX_INDEXABLE_CHARS supera ${MAX_HIGHLIGHTED_CHARS_PER_REQUEST}`,
    );
  }
  if (values.MAX_INDEXABLE_CHARS > values.MAX_EXTRACTED_CHARS) {
    invariantErrors.push('MAX_INDEXABLE_CHARS: no puede superar MAX_EXTRACTED_CHARS');
  }
  if (values.MAX_HIGHLIGHT_CHARS > values.MAX_INDEXABLE_CHARS) {
    invariantErrors.push('MAX_HIGHLIGHT_CHARS: no puede superar MAX_INDEXABLE_CHARS');
  }
  if (invariantErrors.length > 0) {
    throw new ConfigError(
      [...new Set(invariantErrors.map((message) => message.split(':')[0]))],
      invariantErrors,
    );
  }

  return {
    appRole: values.APP_ROLE,
    port: values.PORT,
    databaseUrl: values.DATABASE_URL,
    storageDir: values.STORAGE_DIR,
    corsOrigin: values.CORS_ORIGIN,
    logLevel: values.LOG_LEVEL,
    maxUploadBytesText: values.MAX_UPLOAD_BYTES_TEXT,
    maxUploadBytesPdf: values.MAX_UPLOAD_BYTES_PDF,
    maxPdfPages: values.MAX_PDF_PAGES,
    maxExtractedChars: values.MAX_EXTRACTED_CHARS,
    maxIndexableChars: values.MAX_INDEXABLE_CHARS,
    maxHighlightChars: values.MAX_HIGHLIGHT_CHARS,
    extractionTimeoutMs: values.EXTRACTION_TIMEOUT_MS,
    workerConcurrency: values.WORKER_CONCURRENCY,
    jobRetryLimit: values.JOB_RETRY_LIMIT,
    jobRetryDelaySeconds: values.JOB_RETRY_DELAY_SECONDS,
    maxSseClients: values.MAX_SSE_CLIENTS,
  };
}

/** Oculta la contrasenia de una URL de conexion para registros y mensajes (ADR-14). */
export function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '****';
    return parsed.toString();
  } catch {
    return '[URL invalida]';
  }
}
