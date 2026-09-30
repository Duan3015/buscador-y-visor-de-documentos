import { HIGHLIGHT_END, HIGHLIGHT_START, type SearchResultItem } from '@kata/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../database/client';
import type { SearchPage, SearchRepository } from '../domain/ports';

/** Separador entre fragmentos: caracter de uso privado que el texto normalizado no suele contener. */
const FRAGMENT_DELIMITER = '\uE002';

const HEADLINE_OPTIONS = [
  `StartSel=${HIGHLIGHT_START}`,
  `StopSel=${HIGHLIGHT_END}`,
  `FragmentDelimiter=${FRAGMENT_DELIMITER}`,
  'MaxFragments=2',
  'MaxWords=25',
  'MinWords=10',
].join(', ');

/**
 * Sin este ajuste el planificador elige un recorrido secuencial que evalua `@@` sobre todos los
 * vectores y no usa el indice GIN (unos 125 ms de CPU por consulta con 5.000 documentos, incluso sin
 * resultados). La tabla principal es diminuta porque los vectores y el texto viven en TOAST, y el
 * planificador subestima ese costo. `SET LOCAL` limita el ajuste a la transaccion de busqueda.
 * Evidencia: docs/evidence/api-benchmark/diagnostico/.
 */
const PREFER_INDEX = sql`SET LOCAL enable_seqscan = off`;

type Executor = Pick<Database, 'execute'>;

type SearchRow = {
  id: string;
  title: string;
  author: string;
  category: string;
  tags: string[];
  version: string | null;
  headline: string | null;
  total: string;
};

/**
 * Consulta de busqueda (ADR-03). Forma deliberada para que se use el indice GIN:
 * - `matched` filtra con `@@` sobre `document_contents` sin unirla a otras tablas y con la funcion
 *   `websearch_to_tsquery` en linea; con un `tsquery` en un CTE unido por `CROSS JOIN`, o en una
 *   subconsulta escalar, el planificador no puede usar el indice.
 * - La relevancia se calcula solo sobre los ids coincidentes, y `ts_headline` solo sobre las filas
 *   de la pagina y sobre los primeros `maxHighlightChars` caracteres (costo lineal del resaltado).
 * La consulta viaja siempre como parametro; no se usa LIKE.
 */
export function buildSearchStatement(query: string, offset: number, limit: number, maxHighlightChars: number): SQL {
  return sql`
    WITH q AS MATERIALIZED (SELECT websearch_to_tsquery('es_unaccent', ${query}) AS tsq),
    matched AS MATERIALIZED (
      SELECT document_id
      FROM document_contents
      WHERE search_vector @@ websearch_to_tsquery('es_unaccent', ${query})
    ),
    page AS (
      SELECT d.id, d.title, d.author, d.category, d.tags, d.version, d.created_at,
             c.content, c.indexed_chars,
             ts_rank_cd(c.search_vector, (SELECT tsq FROM q)) AS rank,
             count(*) OVER () AS total
      FROM matched m
      JOIN document_contents c ON c.document_id = m.document_id
      JOIN documents d ON d.id = m.document_id
      WHERE d.status = 'INDEXADO'
      ORDER BY rank DESC, d.created_at DESC, d.id
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT p.id, p.title, p.author, p.category, p.tags, p.version, p.total,
           ts_headline(
             'es_unaccent',
             left(p.content, least(p.indexed_chars, ${maxHighlightChars}::int)),
             (SELECT tsq FROM q),
             ${HEADLINE_OPTIONS}
           ) AS headline
    FROM page p
    ORDER BY p.rank DESC, p.created_at DESC, p.id
  `;
}

/**
 * Busqueda con FTS de PostgreSQL (ADR-03): `websearch_to_tsquery` con la configuracion es_unaccent,
 * indice GIN, ranking con ts_rank_cd y resaltado solo de las filas de la pagina.
 */
export class PostgresSearchRepository implements SearchRepository {
  constructor(
    private readonly database: Database,
    private readonly maxHighlightChars: number,
  ) {}

  async search(query: string, offset: number, limit: number): Promise<SearchPage> {
    return this.database.transaction(async (tx) => {
      await tx.execute(PREFER_INDEX);
      const result = await tx.execute<SearchRow>(buildSearchStatement(query, offset, limit, this.maxHighlightChars));

      const rows = result.rows;
      const total = rows.length > 0 ? Number(rows[0]?.total ?? 0) : await this.countWhenPageIsEmpty(tx, query, offset);

      return { items: rows.map(toItem), total };
    });
  }

  /**
   * Plan de ejecucion de la busqueda con los mismos ajustes que `search`. Es un diagnostico para
   * verificar en las pruebas que el indice GIN se usa; no forma parte del contrato de busqueda.
   */
  async explain(query: string, offset: number, limit: number): Promise<string> {
    return this.database.transaction(async (tx) => {
      await tx.execute(PREFER_INDEX);
      const statement = sql`EXPLAIN (COSTS OFF) ${buildSearchStatement(query, offset, limit, this.maxHighlightChars)}`;
      const result = await tx.execute<{ 'QUERY PLAN': string }>(statement);
      return result.rows.map((row) => row['QUERY PLAN']).join('\n');
    });
  }

  /**
   * Una pagina fuera de rango no devuelve filas y, con ellas, tampoco el total. Se cuenta aparte
   * solo en ese caso, para que el cliente pueda informar cuantas paginas hay.
   */
  private async countWhenPageIsEmpty(executor: Executor, query: string, offset: number): Promise<number> {
    if (offset === 0) return 0;
    const result = await executor.execute<{ total: string }>(sql`
      WITH matched AS MATERIALIZED (
        SELECT document_id
        FROM document_contents
        WHERE search_vector @@ websearch_to_tsquery('es_unaccent', ${query})
      )
      SELECT count(*) AS total
      FROM matched m
      JOIN documents d ON d.id = m.document_id
      WHERE d.status = 'INDEXADO'
    `);
    return Number(result.rows[0]?.total ?? 0);
  }
}

function toItem(row: SearchRow): SearchResultItem {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    category: row.category,
    tags: row.tags,
    version: row.version,
    fragments: extractFragments(row.headline),
  };
}

/** Solo se devuelven los fragmentos con al menos una coincidencia resaltada (E: coincidencia solo en metadatos). */
function extractFragments(headline: string | null): string[] {
  if (!headline) return [];
  return headline
    .split(FRAGMENT_DELIMITER)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.includes(HIGHLIGHT_START));
}
