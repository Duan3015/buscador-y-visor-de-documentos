-- Medicion 1: densidad del texto y tamano del tsvector segun la cantidad de caracteres.
\pset pager off

\echo '=== Densidad del texto (caracteres por palabra, bytes por caracter) ==='
SELECT title,
       length(body) AS chars,
       octet_length(body) AS bytes,
       round(octet_length(body)::numeric / length(body), 3) AS bytes_por_char,
       array_length(regexp_split_to_array(trim(body), '\s+'), 1) AS palabras,
       round(length(body)::numeric / array_length(regexp_split_to_array(trim(body), '\s+'), 1), 2) AS chars_por_palabra
FROM books ORDER BY chars;

\echo '=== Tamano del tsvector segun caracteres (texto natural, config spanish) ==='
CREATE OR REPLACE FUNCTION probe_size(n int) RETURNS TABLE(
  chars int, lexemas int, vec_bytes int, tiempo_ms numeric, resultado text)
LANGUAGE plpgsql AS $$
DECLARE t0 timestamptz; v tsvector; b text;
BEGIN
  SELECT left(body, n) INTO b FROM corpus;
  t0 := clock_timestamp();
  BEGIN
    v := to_tsvector('spanish', b);
    chars := n; lexemas := length(v); vec_bytes := pg_column_size(v);
    tiempo_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
    resultado := 'OK';
  EXCEPTION WHEN OTHERS THEN
    chars := n; lexemas := NULL; vec_bytes := NULL;
    tiempo_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
    resultado := 'ERROR: ' || SQLERRM;
  END;
  RETURN NEXT;
END $$;

SELECT * FROM probe_size(100000);
SELECT * FROM probe_size(500000);
SELECT * FROM probe_size(1000000);
SELECT * FROM probe_size(2000000);
SELECT * FROM probe_size(4000000);
SELECT * FROM probe_size(6500000);

\echo '=== Peor caso: tokens unicos de 32 caracteres (hashes) ==='
CREATE OR REPLACE FUNCTION probe_worst(ntokens int) RETURNS TABLE(
  tokens int, chars int, vec_bytes int, resultado text)
LANGUAGE plpgsql AS $$
DECLARE b text; v tsvector;
BEGIN
  SELECT string_agg(md5(i::text), ' ') INTO b FROM generate_series(1, ntokens) i;
  tokens := ntokens; chars := length(b);
  BEGIN
    v := to_tsvector('simple', b);
    vec_bytes := pg_column_size(v); resultado := 'OK';
  EXCEPTION WHEN OTHERS THEN
    vec_bytes := NULL; resultado := 'ERROR: ' || SQLERRM;
  END;
  RETURN NEXT;
END $$;
SELECT * FROM probe_worst(10000);
SELECT * FROM probe_worst(20000);
SELECT * FROM probe_worst(25000);
SELECT * FROM probe_worst(30000);
