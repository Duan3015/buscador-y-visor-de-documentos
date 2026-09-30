\pset pager off
\o /dev/null
\timing on
\echo ### C1 CTE materializada sin SET (plan por defecto): sin resultados x3
WITH m AS MATERIALIZED (SELECT document_id FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','xyzzyplugh')) SELECT count(*) FROM m;
WITH m AS MATERIALIZED (SELECT document_id FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','xyzzyplugh')) SELECT count(*) FROM m;
WITH m AS MATERIALIZED (SELECT document_id FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','xyzzyplugh')) SELECT count(*) FROM m;
\echo ### C2 CTE materializada con enable_seqscan off local: sin resultados x3
BEGIN;
SET LOCAL enable_seqscan = off;
WITH m AS MATERIALIZED (SELECT document_id FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','xyzzyplugh')) SELECT count(*) FROM m;
WITH m AS MATERIALIZED (SELECT document_id FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','xyzzyplugh')) SELECT count(*) FROM m;
WITH m AS MATERIALIZED (SELECT document_id FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','xyzzyplugh')) SELECT count(*) FROM m;
COMMIT;

\echo ### D consulta completa con CTE materializada + seqscan off, caballero, headline completo x3
BEGIN;
SET LOCAL enable_seqscan = off;
WITH q AS MATERIALIZED (SELECT websearch_to_tsquery('es_unaccent','caballero') AS tsq),
m AS MATERIALIZED (SELECT document_id FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','caballero')),
r AS (SELECT c.document_id, c.content, c.indexed_chars, ts_rank_cd(c.search_vector, websearch_to_tsquery('es_unaccent','caballero')) AS rank, count(*) OVER () AS total, d.created_at FROM m JOIN document_contents c ON c.document_id = m.document_id JOIN documents d ON d.id = m.document_id WHERE d.status='INDEXADO' ORDER BY rank DESC, d.created_at DESC, d.id LIMIT 10)
SELECT r.document_id, r.total, ts_headline('es_unaccent', left(r.content, r.indexed_chars), websearch_to_tsquery('es_unaccent','caballero'), 'MaxFragments=2, MaxWords=25, MinWords=10') FROM r;
WITH q AS MATERIALIZED (SELECT websearch_to_tsquery('es_unaccent','caballero') AS tsq),
m AS MATERIALIZED (SELECT document_id FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','caballero')),
r AS (SELECT c.document_id, c.content, c.indexed_chars, ts_rank_cd(c.search_vector, websearch_to_tsquery('es_unaccent','caballero')) AS rank, count(*) OVER () AS total, d.created_at FROM m JOIN document_contents c ON c.document_id = m.document_id JOIN documents d ON d.id = m.document_id WHERE d.status='INDEXADO' ORDER BY rank DESC, d.created_at DESC, d.id LIMIT 10)
SELECT r.document_id, r.total, ts_headline('es_unaccent', left(r.content, r.indexed_chars), websearch_to_tsquery('es_unaccent','caballero'), 'MaxFragments=2, MaxWords=25, MinWords=10') FROM r;
WITH q AS MATERIALIZED (SELECT websearch_to_tsquery('es_unaccent','caballero') AS tsq),
m AS MATERIALIZED (SELECT document_id FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','caballero')),
r AS (SELECT c.document_id, c.content, c.indexed_chars, ts_rank_cd(c.search_vector, websearch_to_tsquery('es_unaccent','caballero')) AS rank, count(*) OVER () AS total, d.created_at FROM m JOIN document_contents c ON c.document_id = m.document_id JOIN documents d ON d.id = m.document_id WHERE d.status='INDEXADO' ORDER BY rank DESC, d.created_at DESC, d.id LIMIT 10)
SELECT r.document_id, r.total, ts_headline('es_unaccent', left(r.content, r.indexed_chars), websearch_to_tsquery('es_unaccent','caballero'), 'MaxFragments=2, MaxWords=25, MinWords=10') FROM r;
COMMIT;

\echo ### E igual que D pero headline limitado a 100000 caracteres x3
BEGIN;
SET LOCAL enable_seqscan = off;
WITH m AS MATERIALIZED (SELECT document_id FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','caballero')),
r AS (SELECT c.document_id, c.content, c.indexed_chars, ts_rank_cd(c.search_vector, websearch_to_tsquery('es_unaccent','caballero')) AS rank, count(*) OVER () AS total, d.created_at FROM m JOIN document_contents c ON c.document_id = m.document_id JOIN documents d ON d.id = m.document_id WHERE d.status='INDEXADO' ORDER BY rank DESC, d.created_at DESC, d.id LIMIT 10)
SELECT r.document_id, r.total, ts_headline('es_unaccent', left(r.content, least(r.indexed_chars, 100000)), websearch_to_tsquery('es_unaccent','caballero'), 'MaxFragments=2, MaxWords=25, MinWords=10') FROM r;
WITH m AS MATERIALIZED (SELECT document_id FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','caballero')),
r AS (SELECT c.document_id, c.content, c.indexed_chars, ts_rank_cd(c.search_vector, websearch_to_tsquery('es_unaccent','caballero')) AS rank, count(*) OVER () AS total, d.created_at FROM m JOIN document_contents c ON c.document_id = m.document_id JOIN documents d ON d.id = m.document_id WHERE d.status='INDEXADO' ORDER BY rank DESC, d.created_at DESC, d.id LIMIT 10)
SELECT r.document_id, r.total, ts_headline('es_unaccent', left(r.content, least(r.indexed_chars, 100000)), websearch_to_tsquery('es_unaccent','caballero'), 'MaxFragments=2, MaxWords=25, MinWords=10') FROM r;
WITH m AS MATERIALIZED (SELECT document_id FROM document_contents WHERE search_vector @@ websearch_to_tsquery('es_unaccent','caballero')),
r AS (SELECT c.document_id, c.content, c.indexed_chars, ts_rank_cd(c.search_vector, websearch_to_tsquery('es_unaccent','caballero')) AS rank, count(*) OVER () AS total, d.created_at FROM m JOIN document_contents c ON c.document_id = m.document_id JOIN documents d ON d.id = m.document_id WHERE d.status='INDEXADO' ORDER BY rank DESC, d.created_at DESC, d.id LIMIT 10)
SELECT r.document_id, r.total, ts_headline('es_unaccent', left(r.content, least(r.indexed_chars, 100000)), websearch_to_tsquery('es_unaccent','caballero'), 'MaxFragments=2, MaxWords=25, MinWords=10') FROM r;
COMMIT;
