\pset pager off
\echo ### estadisticas
SELECT relname, reltuples, relpages FROM pg_class WHERE relname IN ('document_contents','documents');
SELECT last_analyze, last_autoanalyze, n_live_tup FROM pg_stat_user_tables WHERE relname='document_contents';
\d document_contents

SET enable_seqscan = off;
\echo ### enable_seqscan=off: sin resultados
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT d.id, ts_rank_cd(c.search_vector, (SELECT websearch_to_tsquery('es_unaccent','xyzzyplugh'))) AS rank, count(*) OVER ()
FROM document_contents c JOIN documents d ON d.id = c.document_id
WHERE d.status='INDEXADO' AND c.search_vector @@ (SELECT websearch_to_tsquery('es_unaccent','xyzzyplugh'))
ORDER BY rank DESC LIMIT 10;
\echo ### enable_seqscan=off: palabra rara aldonza
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT d.id, ts_rank_cd(c.search_vector, (SELECT websearch_to_tsquery('es_unaccent','aldonza'))) AS rank, count(*) OVER ()
FROM document_contents c JOIN documents d ON d.id = c.document_id
WHERE d.status='INDEXADO' AND c.search_vector @@ (SELECT websearch_to_tsquery('es_unaccent','aldonza'))
ORDER BY rank DESC LIMIT 10;
\echo ### enable_seqscan=off: caballero
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT d.id, ts_rank_cd(c.search_vector, (SELECT websearch_to_tsquery('es_unaccent','caballero'))) AS rank, count(*) OVER ()
FROM document_contents c JOIN documents d ON d.id = c.document_id
WHERE d.status='INDEXADO' AND c.search_vector @@ (SELECT websearch_to_tsquery('es_unaccent','caballero'))
ORDER BY rank DESC LIMIT 10;
RESET enable_seqscan;

\echo ### Costo de evaluar @@ sobre todos los vectores (sin rank), sin resultados, seqscan
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT count(*) FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','xyzzyplugh');
\echo ### con indice
SET enable_seqscan = off;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT count(*) FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','xyzzyplugh');
RESET enable_seqscan;
