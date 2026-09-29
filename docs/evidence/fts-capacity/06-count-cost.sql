-- Medicion 6: costo de calcular `total` (conteo exacto de coincidencias) en la respuesta de busqueda.
-- Requiere la tabla docs_cap creada por 05-verify-dual-vector.sql (vector doble, 1.500 documentos de 300.000 caracteres).
-- Uso: psql -f 06-count-cost.sql
\pset pager off
SET max_parallel_workers_per_gather = 0;

CREATE OR REPLACE FUNCTION bench_count(qtext text, iters int) RETURNS TABLE(
  consulta text, coincidentes bigint, count_p50_ms numeric, count_p95_ms numeric, count_max_ms numeric)
LANGUAGE plpgsql AS $$
DECLARE tq tsquery; t0 timestamptz; i int; a numeric[] := '{}';
BEGIN
  tq := websearch_to_tsquery('spanish', qtext) || websearch_to_tsquery('spanish', unaccent(qtext));
  FOR i IN 1..iters LOOP
    t0 := clock_timestamp();
    SELECT count(*) INTO coincidentes FROM docs_cap WHERE content_tsv @@ tq;
    a := a || (extract(epoch FROM clock_timestamp() - t0) * 1000)::numeric;
  END LOOP;
  consulta := qtext;
  SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY x)::numeric, 1),
         round(percentile_cont(0.95) WITHIN GROUP (ORDER BY x)::numeric, 1),
         round(max(x), 1) INTO count_p50_ms, count_p95_ms, count_max_ms FROM unnest(a) x;
  RETURN NEXT;
END $$;

SELECT * FROM bench_count('Dulcinea', 20);
SELECT * FROM bench_count('molinos de viento', 20);
SELECT * FROM bench_count('caballero armado', 20);
SELECT * FROM bench_count('vuestra merced', 20);
SELECT * FROM bench_count('"vuestra merced"', 20);
