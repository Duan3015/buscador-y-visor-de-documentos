-- Medicion 5: vector doble (spanish con acentos + spanish sin acentos), para busqueda por raiz y sin distinguir acentos.
-- Variante de la medicion 3 (04-verify-cap.sql).
-- Medicion 3: verificacion del tope. Todos los documentos miden exactamente :cap caracteres (peor caso).
-- Uso: psql -v cap=300000 -v ndocs=1500 -f 05-verify-dual-vector.sql
-- Mide latencia (p50, p95, maximo de 20 ejecuciones) de:
--   a) top-10 por ranking
--   b) top-10 por ranking + resaltado del texto completo de esos 10
\pset pager off
SET max_parallel_workers_per_gather = 0;

DROP TABLE IF EXISTS docs_cap;
CREATE TABLE docs_cap (id serial PRIMARY KEY, body text, content_tsv tsvector);

INSERT INTO docs_cap (body)
SELECT substring(c.body FROM 1 + (random() * (length(c.body) - :cap))::int FOR :cap)
FROM corpus c, generate_series(1, :ndocs);

UPDATE docs_cap SET content_tsv = to_tsvector('spanish', body) || to_tsvector('spanish', unaccent(body));
CREATE INDEX docs_cap_gin ON docs_cap USING gin (content_tsv);
VACUUM ANALYZE docs_cap;

SELECT count(*) AS docs,
       min(length(body)) AS chars_min, max(length(body)) AS chars_max,
       pg_size_pretty(sum(octet_length(body))) AS texto_total,
       pg_size_pretty(pg_relation_size('docs_cap_gin')) AS gin_index,
       pg_size_pretty(avg(pg_column_size(content_tsv))::bigint) AS vector_promedio
FROM docs_cap;

CREATE OR REPLACE FUNCTION bench_cap(qtext text, iters int) RETURNS TABLE(
  consulta text, coincidentes bigint,
  rank_p50_ms numeric, rank_p95_ms numeric, rank_max_ms numeric,
  full_p50_ms numeric, full_p95_ms numeric, full_max_ms numeric)
LANGUAGE plpgsql AS $$
DECLARE tq tsquery; t0 timestamptz; i int; a numeric[] := '{}'; b numeric[] := '{}';
BEGIN
  tq := websearch_to_tsquery('spanish', qtext) || websearch_to_tsquery('spanish', unaccent(qtext));
  SELECT count(*) INTO coincidentes FROM docs_cap WHERE content_tsv @@ tq;
  FOR i IN 1..iters LOOP
    t0 := clock_timestamp();
    PERFORM id FROM docs_cap WHERE content_tsv @@ tq ORDER BY ts_rank_cd(content_tsv, tq) DESC LIMIT 10;
    a := a || (extract(epoch FROM clock_timestamp() - t0) * 1000)::numeric;
    t0 := clock_timestamp();
    PERFORM ts_headline('spanish', d.body, tq, 'MaxFragments=2, MaxWords=25, MinWords=10')
    FROM (SELECT id, body FROM docs_cap WHERE content_tsv @@ tq
          ORDER BY ts_rank_cd(content_tsv, tq) DESC LIMIT 10) d;
    b := b || (extract(epoch FROM clock_timestamp() - t0) * 1000)::numeric;
  END LOOP;
  consulta := qtext;
  SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY x)::numeric, 1),
         round(percentile_cont(0.95) WITHIN GROUP (ORDER BY x)::numeric, 1),
         round(max(x), 1) INTO rank_p50_ms, rank_p95_ms, rank_max_ms FROM unnest(a) x;
  SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY x)::numeric, 1),
         round(percentile_cont(0.95) WITHIN GROUP (ORDER BY x)::numeric, 1),
         round(max(x), 1) INTO full_p50_ms, full_p95_ms, full_max_ms FROM unnest(b) x;
  RETURN NEXT;
END $$;

SELECT * FROM bench_cap('Dulcinea', 20);
SELECT * FROM bench_cap('molinos de viento', 20);
SELECT * FROM bench_cap('caballero armado', 20);
SELECT * FROM bench_cap('vuestra merced', 20);
SELECT * FROM bench_cap('"vuestra merced"', 20);
