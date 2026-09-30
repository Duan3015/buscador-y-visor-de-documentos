import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey(),
    title: text('title').notNull(),
    author: text('author').notNull(),
    category: text('category').notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    version: text('version'),
    format: text('format').notNull(),
    originalFilename: text('original_filename').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    fileSha256: char('file_sha256', { length: 64 }).notNull().unique('documents_file_sha256_key'),
    status: text('status').notNull().default('PROCESANDO'),
    lastErrorCode: text('last_error_code'),
    lastErrorDetail: text('last_error_detail'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
  },
  (table) => [
    check('documents_status_check', sql`${table.status} in ('PROCESANDO', 'INDEXADO', 'ERROR')`),
    check('documents_format_check', sql`${table.format} in ('TXT', 'MARKDOWN', 'PDF')`),
    check(
      'documents_error_requires_code_check',
      sql`${table.status} <> 'ERROR' or ${table.lastErrorCode} is not null`,
    ),
  ],
);

export const documentContents = pgTable(
  'document_contents',
  {
    documentId: uuid('document_id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    totalChars: integer('total_chars').notNull(),
    indexedChars: integer('indexed_chars').notNull(),
    isPartiallyIndexed: boolean('is_partially_indexed').notNull(),
    searchVector: tsvector('search_vector').notNull(),
  },
  (table) => [index('document_contents_search_vector_idx').using('gin', table.searchVector)],
);

export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;
export type DocumentContentRow = typeof documentContents.$inferSelect;
