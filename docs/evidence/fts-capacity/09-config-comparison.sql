-- Medicion 9: comparacion de configuraciones de busqueda sobre un conjunto pequeno y legible.
-- Configuraciones:
--   A  = spanish + unaccent (un solo vector; consulta con unaccent)
--   B  = simple + unaccent (sin lematizacion)
--   C  = spanish sin unaccent (un solo vector)
--   D  = vector doble (spanish con y sin acentos)
-- Para cada consulta se listan los documentos encontrados.
-- Documentos:
--   1 La instalación del servicio
--   2 Las instalaciones de los servicios
--   3 Guía para instalar el servicio
--   4 Configuración de documentos
--   5 Configurar un documento
--   6 La instalacion del servicio (escrito sin tilde)
\pset pager off
CREATE EXTENSION IF NOT EXISTS unaccent;

DROP TABLE IF EXISTS cmp;
CREATE TABLE cmp (id int, t text);
INSERT INTO cmp VALUES
 (1, 'La instalación del servicio'),
 (2, 'Las instalaciones de los servicios'),
 (3, 'Guía para instalar el servicio'),
 (4, 'Configuración de documentos'),
 (5, 'Configurar un documento'),
 (6, 'La instalacion del servicio');

CREATE OR REPLACE FUNCTION ids_encontrados(cfg text, docvec text, q text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE format($f$
    SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '-') FROM cmp
    WHERE %s @@ %s
  $f$,
    CASE docvec
      WHEN 'A' THEN 'to_tsvector(''spanish'', unaccent(t))'
      WHEN 'B' THEN 'to_tsvector(''simple'', unaccent(t))'
      WHEN 'C' THEN 'to_tsvector(''spanish'', t)'
      WHEN 'D' THEN '(to_tsvector(''spanish'', t) || to_tsvector(''spanish'', unaccent(t)))'
    END,
    CASE docvec
      WHEN 'A' THEN format('websearch_to_tsquery(''spanish'', unaccent(%L))', q)
      WHEN 'B' THEN format('websearch_to_tsquery(''simple'', unaccent(%L))', q)
      WHEN 'C' THEN format('websearch_to_tsquery(''spanish'', %L)', q)
      WHEN 'D' THEN format('(websearch_to_tsquery(''spanish'', %L) || websearch_to_tsquery(''spanish'', unaccent(%L)))', q, q)
    END) INTO r;
  RETURN r;
END $$;

SELECT q AS consulta,
       ids_encontrados('', 'A', q) AS "A spanish+unaccent",
       ids_encontrados('', 'B', q) AS "B simple+unaccent",
       ids_encontrados('', 'C', q) AS "C spanish",
       ids_encontrados('', 'D', q) AS "D doble"
FROM (VALUES
  ('instalación'), ('instalacion'), ('instalaciones'), ('instalar'),
  ('servicio'), ('servicios'),
  ('configuración'), ('configuracion'), ('configurar'),
  ('documento'), ('documentos'),
  ('"instalación del servicio"'), ('"instalacion del servicio"')
) t(q);
