\timing on
\echo === sin resultados (execution) ===
EXPLAIN (ANALYZE, BUFFERS, TIMING ON)
WITH q AS (SELECT websearch_to_tsquery('es_unaccent', 'xyzzyplugh') AS tsq),
page AS (
  SELECT d.id, d.title, c.content, c.indexed_chars, ts_rank_cd(c.search_vector, q.tsq) AS rank, count(*) OVER () AS total
  FROM document_contents c JOIN documents d ON d.id = c.document_id CROSS JOIN q
  WHERE d.status = 'INDEXADO' AND c.search_vector @@ q.tsq
  ORDER BY rank DESC, d.created_at DESC, d.id LIMIT 10 OFFSET 0)
SELECT p.id, p.total, ts_headline('es_unaccent', left(p.content, p.indexed_chars), (SELECT tsq FROM q), 'MaxFragments=2, MaxWords=25, MinWords=10') FROM page p;

\echo === palabra frecuente caballero ===
EXPLAIN (ANALYZE, BUFFERS, TIMING ON)
WITH q AS (SELECT websearch_to_tsquery('es_unaccent', 'caballero') AS tsq),
page AS (
  SELECT d.id, d.title, c.content, c.indexed_chars, ts_rank_cd(c.search_vector, q.tsq) AS rank, count(*) OVER () AS total
  FROM document_contents c JOIN documents d ON d.id = c.document_id CROSS JOIN q
  WHERE d.status = 'INDEXADO' AND c.search_vector @@ q.tsq
  ORDER BY rank DESC, d.created_at DESC, d.id LIMIT 10 OFFSET 0)
SELECT p.id, p.total, ts_headline('es_unaccent', left(p.content, p.indexed_chars), (SELECT tsq FROM q), 'MaxFragments=2, MaxWords=25, MinWords=10') FROM page p;

\echo === tamanos ===
SELECT count(*) AS docs, pg_size_pretty(sum(pg_column_size(search_vector))::bigint) AS vectores, pg_size_pretty(sum(pg_column_size(content))::bigint) AS contenido, round(avg(indexed_chars)) AS avg_chars, max(indexed_chars) AS max_chars FROM document_contents;
SELECT relname, pg_size_pretty(pg_relation_size(oid)) AS size FROM pg_class WHERE relname IN ('document_contents','documents') OR relname LIKE '%search_vector%' OR relname LIKE '%gin%';
SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers','work_mem','effective_cache_size','max_parallel_workers_per_gather','jit');
