import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { assertDatabaseReady } from '../../src/database/schema-check';

describe('esquema de base de datos (integracion)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM documents');
  });

  const insertDocument = (overrides: { sha?: string; status?: string; code?: string | null } = {}) =>
    pool.query(
      `INSERT INTO documents (id, title, author, category, format, original_filename, size_bytes, file_sha256, status, last_error_code)
       VALUES ($1, 't', 'a', 'c', 'TXT', 'x.txt', 10, $2, $3, $4)`,
      [
        randomUUID(),
        overrides.sha ?? 'a'.repeat(64),
        overrides.status ?? 'PROCESANDO',
        overrides.code ?? null,
      ],
    );

  it('reconoce que el esquema esta listo', async () => {
    await expect(assertDatabaseReady(pool)).resolves.toBeUndefined();
  });

  it('rechaza una segunda huella igual con violacion de unicidad (E-33)', async () => {
    await insertDocument();
    await expect(insertDocument()).rejects.toMatchObject({ code: '23505' });
  });

  it('no permite un documento en ERROR sin causa', async () => {
    await expect(insertDocument({ status: 'ERROR', code: null })).rejects.toMatchObject({ code: '23514' });
    await expect(insertDocument({ status: 'ERROR', code: 'PDF_CORRUPT' })).resolves.toBeDefined();
  });

  it('rechaza un estado fuera del catalogo', async () => {
    await expect(insertDocument({ status: 'OTRO' })).rejects.toMatchObject({ code: '23514' });
  });

  it('elimina el contenido al eliminar el documento (ON DELETE CASCADE)', async () => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO documents (id, title, author, category, format, original_filename, size_bytes, file_sha256)
       VALUES ($1, 't', 'a', 'c', 'TXT', 'x.txt', 10, $2)`,
      [id, 'b'.repeat(64)],
    );
    await pool.query(
      `INSERT INTO document_contents (document_id, content, total_chars, indexed_chars, is_partially_indexed, search_vector)
       VALUES ($1, 'hola', 4, 4, false, to_tsvector('es_unaccent', 'hola'))`,
      [id],
    );
    await pool.query('DELETE FROM documents WHERE id = $1', [id]);
    const remaining = await pool.query('SELECT 1 FROM document_contents WHERE document_id = $1', [id]);
    expect(remaining.rowCount).toBe(0);
  });

  it('la configuracion es_unaccent encuentra palabras con y sin tilde y sus plurales (E-22)', async () => {
    const result = await pool.query<{ withAccent: boolean; withoutAccent: boolean; plural: boolean }>(
      `SELECT
         to_tsvector('es_unaccent', 'La instalación del servicio') @@ websearch_to_tsquery('es_unaccent', 'instalacion') AS "withAccent",
         to_tsvector('es_unaccent', 'La instalacion del servicio') @@ websearch_to_tsquery('es_unaccent', 'instalación') AS "withoutAccent",
         to_tsvector('es_unaccent', 'Los servicios') @@ websearch_to_tsquery('es_unaccent', 'servicio') AS plural`,
    );
    expect(result.rows[0]).toEqual({ withAccent: true, withoutAccent: true, plural: true });
  });
});
