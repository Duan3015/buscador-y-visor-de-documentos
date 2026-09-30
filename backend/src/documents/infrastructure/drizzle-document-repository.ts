import type { DocumentDetail, DocumentErrorCode, DocumentStatusItem } from '@kata/shared';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '../../database/client';
import { documentContents, documents } from '../../database/schema';
import type { Document } from '../domain/document';
import type {
  DocumentRef,
  DocumentRepository,
  ErrorDocumentSummary,
  FailureRecord,
  IndexedContentInput,
  ProcessingCandidate,
  PurgeFilter,
  TransactionContext,
} from '../domain/ports';
import { DuplicateFingerprintError, IndexLimitError } from '../domain/processing-error';
import { transactionOf } from './drizzle-unit-of-work';
import { PROGRAM_LIMIT_EXCEEDED, UNIQUE_VIOLATION, findPgError } from './pg-errors';

const SHA_CONSTRAINT = 'documents_file_sha256_key';

export class DrizzleDocumentRepository implements DocumentRepository {
  constructor(private readonly database: Database) {}

  async insert(ctx: TransactionContext, document: Document): Promise<void> {
    const p = document.props;
    try {
      await transactionOf(ctx)
        .insert(documents)
        .values({
          id: p.id,
          title: p.title,
          author: p.author,
          category: p.category,
          tags: p.tags,
          version: p.version,
          format: p.format,
          originalFilename: p.originalFilename,
          sizeBytes: p.sizeBytes,
          fileSha256: p.fileSha256,
          status: p.status,
          createdAt: p.createdAt,
        });
    } catch (error) {
      const info = findPgError(error);
      if (info?.code === UNIQUE_VIOLATION && info.constraint === SHA_CONSTRAINT) {
        throw new DuplicateFingerprintError();
      }
      throw error;
    }
  }

  async findRefByFileSha256(fileSha256: string): Promise<DocumentRef | null> {
    const rows = await this.database
      .select({ id: documents.id, status: documents.status })
      .from(documents)
      .where(eq(documents.fileSha256, fileSha256))
      .limit(1);
    const row = rows[0];
    return row ? { id: row.id, status: row.status as DocumentRef['status'] } : null;
  }

  async findProcessingCandidate(id: string): Promise<ProcessingCandidate | null> {
    const rows = await this.database
      .select({ id: documents.id, format: documents.format, status: documents.status })
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      format: row.format as ProcessingCandidate['format'],
      status: row.status as ProcessingCandidate['status'],
    };
  }

  async saveIndexedContent(
    ctx: TransactionContext,
    id: string,
    input: IndexedContentInput,
    at: Date,
  ): Promise<boolean> {
    const tx = transactionOf(ctx);

    const updated = await tx
      .update(documents)
      .set({
        status: 'INDEXADO',
        indexedAt: at,
        lastErrorCode: null,
        lastErrorDetail: null,
        lastErrorAt: null,
      })
      .where(and(eq(documents.id, id), eq(documents.status, 'PROCESANDO')))
      .returning({ id: documents.id });
    if (updated.length === 0) return false;

    const isPartial = input.indexedChars < input.totalChars;
    try {
      // El vector se calcula en la base de datos con la composicion de ADR-03:
      // titulo (A), metadatos (B) y prefijo indexable del contenido (D).
      await tx.execute(sql`
        with src as (select ${input.content}::text as content)
        insert into document_contents
          (document_id, content, total_chars, indexed_chars, is_partially_indexed, search_vector)
        select
          d.id,
          src.content,
          ${input.totalChars}::int,
          ${input.indexedChars}::int,
          ${isPartial}::boolean,
          setweight(to_tsvector('es_unaccent', d.title), 'A')
            || setweight(
              to_tsvector(
                'es_unaccent',
                d.author || ' ' || d.category || ' ' || array_to_string(d.tags, ' ') || ' ' || coalesce(d.version, '')
              ),
              'B'
            )
            || setweight(to_tsvector('es_unaccent', left(src.content, ${input.indexedChars}::int)), 'D')
        from documents d cross join src
        where d.id = ${id}
      `);
    } catch (error) {
      if (findPgError(error)?.code === PROGRAM_LIMIT_EXCEEDED) throw new IndexLimitError();
      throw error;
    }
    return true;
  }

  async markFailed(ctx: TransactionContext, id: string, failure: FailureRecord): Promise<boolean> {
    const countAttempt = failure.countAttempt ?? true;
    const updated = await transactionOf(ctx)
      .update(documents)
      .set({
        status: 'ERROR',
        lastErrorCode: failure.code,
        lastErrorDetail: failure.detail,
        lastErrorAt: failure.at,
        ...(countAttempt ? { attempts: sql`${documents.attempts} + 1` } : {}),
      })
      .where(and(eq(documents.id, id), eq(documents.status, 'PROCESANDO')))
      .returning({ id: documents.id });
    return updated.length > 0;
  }

  async recordAttemptFailure(id: string, failure: FailureRecord): Promise<void> {
    await this.database
      .update(documents)
      .set({
        lastErrorCode: failure.code,
        lastErrorDetail: failure.detail,
        lastErrorAt: failure.at,
        attempts: sql`${documents.attempts} + 1`,
      })
      .where(and(eq(documents.id, id), eq(documents.status, 'PROCESANDO')));
  }

  async findLastErrorCode(id: string): Promise<DocumentErrorCode | null> {
    const rows = await this.database
      .select({ code: documents.lastErrorCode })
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);
    return (rows[0]?.code as DocumentErrorCode | null | undefined) ?? null;
  }

  async findDetailById(id: string): Promise<DocumentDetail | null> {
    const rows = await this.database
      .select({
        doc: documents,
        content: documentContents.content,
        totalChars: documentContents.totalChars,
        indexedChars: documentContents.indexedChars,
        isPartiallyIndexed: documentContents.isPartiallyIndexed,
      })
      .from(documents)
      .leftJoin(documentContents, eq(documentContents.documentId, documents.id))
      .where(eq(documents.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const d = row.doc;
    const status = d.status as DocumentDetail['status'];
    return {
      id: d.id,
      title: d.title,
      author: d.author,
      category: d.category,
      tags: d.tags,
      version: d.version,
      format: d.format as DocumentDetail['format'],
      originalFilename: d.originalFilename,
      sizeBytes: d.sizeBytes,
      status,
      error:
        status === 'ERROR' && d.lastErrorCode
          ? { code: d.lastErrorCode as DocumentErrorCode, attempts: d.attempts }
          : null,
      createdAt: d.createdAt.toISOString(),
      indexedAt: d.indexedAt ? d.indexedAt.toISOString() : null,
      content: row.content,
      totalChars: row.totalChars,
      indexedChars: row.indexedChars,
      isPartiallyIndexed: row.isPartiallyIndexed,
    };
  }

  async findStatusesByIds(ids: string[]): Promise<DocumentStatusItem[]> {
    if (ids.length === 0) return [];
    const rows = await this.database
      .select({ id: documents.id, status: documents.status, code: documents.lastErrorCode })
      .from(documents)
      .where(inArray(documents.id, ids));
    return rows.map((row) => {
      const status = row.status as DocumentStatusItem['status'];
      return {
        id: row.id,
        status,
        errorCode: status === 'ERROR' ? (row.code as DocumentErrorCode | null) : null,
      };
    });
  }

  async listErrorDocuments(filter: PurgeFilter): Promise<ErrorDocumentSummary[]> {
    const conditions = [eq(documents.status, 'ERROR')];
    if (filter.code) conditions.push(eq(documents.lastErrorCode, filter.code));
    if (filter.olderThan) conditions.push(lt(documents.lastErrorAt, filter.olderThan));
    const rows = await this.database
      .select({
        id: documents.id,
        title: documents.title,
        code: documents.lastErrorCode,
        lastErrorAt: documents.lastErrorAt,
      })
      .from(documents)
      .where(and(...conditions));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      code: row.code as DocumentErrorCode,
      lastErrorAt: row.lastErrorAt,
    }));
  }

  async deleteErrorDocument(id: string): Promise<boolean> {
    const deleted = await this.database
      .delete(documents)
      .where(and(eq(documents.id, id), eq(documents.status, 'ERROR')))
      .returning({ id: documents.id });
    return deleted.length > 0;
  }
}
