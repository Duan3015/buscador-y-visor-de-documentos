-- Medicion 2: tope de posiciones (16383) frente a frases exactas, y costo del resaltado.
\pset pager off

\echo '=== Caracter y pagina aproximados donde se alcanza la palabra 16383 ==='
WITH q AS (SELECT body FROM books WHERE id = 2000)
SELECT
  round(16383 * (length(body)::numeric / array_length(regexp_split_to_array(trim(body), '\s+'), 1))) AS chars_aprox_palabra_16383,
  round(16383 * (length(body)::numeric / array_length(regexp_split_to_array(trim(body), '\s+'), 1)) / 2600, 1) AS paginas_aprox_2600_chars_por_pagina
FROM q;

\echo '=== Frase de dos palabras adyacentes tomada en un desplazamiento: vector completo frente a ventana ==='
CREATE OR REPLACE FUNCTION probe_phrase(off int) RETURNS TABLE(
  offset_chars int, frase text, en_vector_completo boolean, en_ventana_20k boolean)
LANGUAGE plpgsql AS $$
DECLARE b text; m text[]; full_v tsvector; win_v tsvector; tq tsquery;
BEGIN
  SELECT body INTO b FROM books WHERE id = 2000;
  m := regexp_match(substring(b from off for 400), '([[:alpha:]]{6,}) ([[:alpha:]]{6,})');
  frase := m[1] || ' ' || m[2];
  offset_chars := off;
  full_v := to_tsvector('spanish', b);
  win_v := to_tsvector('spanish', substring(b from greatest(off - 5000, 1) for 20000));
  tq := phraseto_tsquery('spanish', frase);
  en_vector_completo := full_v @@ tq;
  en_ventana_20k := win_v @@ tq;
  RETURN NEXT;
END $$;
SELECT * FROM probe_phrase(20000);
SELECT * FROM probe_phrase(60000);
SELECT * FROM probe_phrase(90000);
SELECT * FROM probe_phrase(500000);
SELECT * FROM probe_phrase(1000000);

\echo '=== Costo de ts_headline y ts_rank_cd segun tamano del texto ==='
CREATE OR REPLACE FUNCTION probe_headline(n int, q text) RETURNS TABLE(
  chars int, headline_ms numeric, rank_ms numeric)
LANGUAGE plpgsql AS $$
DECLARE b text; v tsvector; tq tsquery; t0 timestamptz; h text; r real; i int;
BEGIN
  SELECT left(body, n) INTO b FROM books WHERE id = 2000;
  tq := websearch_to_tsquery('spanish', q);
  v := to_tsvector('spanish', b);
  t0 := clock_timestamp();
  FOR i IN 1..5 LOOP
    h := ts_headline('spanish', b, tq, 'MaxFragments=2, MaxWords=25, MinWords=10');
  END LOOP;
  headline_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000 / 5, 2);
  t0 := clock_timestamp();
  FOR i IN 1..5 LOOP r := ts_rank_cd(v, tq); END LOOP;
  rank_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000 / 5, 2);
  chars := n;
  RETURN NEXT;
END $$;
SELECT * FROM probe_headline(3000, 'caballero armado');
SELECT * FROM probe_headline(100000, 'caballero armado');
SELECT * FROM probe_headline(300000, 'caballero armado');
SELECT * FROM probe_headline(500000, 'caballero armado');
SELECT * FROM probe_headline(1000000, 'caballero armado');
SELECT * FROM probe_headline(2000000, 'caballero armado');
