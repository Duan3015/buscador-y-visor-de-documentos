-- Medicion 10: configuracion de busqueda propia (es_unaccent) = diccionario unaccent seguido del lematizador spanish.
-- Es el patron recomendado por la documentacion de PostgreSQL: se define una vez en la migracion, no requiere funciones
-- envoltorio y ts_headline la usa para localizar palabras acentuadas conservando el texto original con sus tildes.
\pset pager off
CREATE EXTENSION IF NOT EXISTS unaccent;

DROP TEXT SEARCH CONFIGURATION IF EXISTS es_unaccent;
CREATE TEXT SEARCH CONFIGURATION es_unaccent (COPY = spanish);
ALTER TEXT SEARCH CONFIGURATION es_unaccent
  ALTER MAPPING FOR hword, hword_part, word
  WITH unaccent, spanish_stem;

\echo '--- 1. Lexemas: la configuracion propia equivale a "spanish + unaccent" ---'
SELECT to_tsvector('es_unaccent', 'Las instalaciones y la instalación de los servicios en producción')::text AS es_unaccent,
       to_tsvector('spanish', unaccent('Las instalaciones y la instalación de los servicios en producción'))::text AS spanish_con_unaccent_previo;

DROP TABLE IF EXISTS cmp;
CREATE TABLE cmp (id int, t text);
INSERT INTO cmp VALUES
 (1, 'La instalación del servicio'),
 (2, 'Las instalaciones de los servicios'),
 (3, 'Guía para instalar el servicio'),
 (4, 'Configuración de documentos'),
 (5, 'Configurar un documento'),
 (6, 'La instalacion del servicio');

\echo '--- 2. Documentos encontrados (mismo conjunto que la configuracion A de la medicion 9) ---'
SELECT q AS consulta,
       (SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '-') FROM cmp
        WHERE to_tsvector('es_unaccent', t) @@ websearch_to_tsquery('es_unaccent', q)) AS encontrados
FROM (VALUES
  ('instalación'), ('instalacion'), ('instalaciones'), ('instalar'),
  ('servicio'), ('servicios'), ('configuración'), ('configuracion'), ('configurar'),
  ('documento'), ('documentos'), ('"instalación del servicio"'), ('"instalacion del servicio"'), ('Configuración')
) t(q);

\echo '--- 3. Resaltado: consulta sin tilde sobre texto con tilde, el fragmento conserva las tildes ---'
SELECT ts_headline('es_unaccent', 'La instalación del servicio requiere configuración previa en producción.',
                   websearch_to_tsquery('es_unaccent', 'instalacion produccion'),
                   'StartSel=[, StopSel=], MaxFragments=2, MaxWords=20, MinWords=5') AS con_es_unaccent,
       ts_headline('spanish', 'La instalación del servicio requiere configuración previa en producción.',
                   websearch_to_tsquery('spanish', unaccent('instalacion produccion')),
                   'StartSel=[, StopSel=], MaxFragments=2, MaxWords=20, MinWords=5') AS con_spanish_sin_config_propia;

\echo '--- 4. Consultas hostiles y vacias con la configuracion propia ---'
SELECT q, websearch_to_tsquery('es_unaccent', q) AS tsquery
FROM (VALUES ('foo:* (bar'), ('a & b | c ! d'), ('el de la'), ('   '), ('drop table documents; --')) t(q);
