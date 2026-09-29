CREATE EXTENSION IF NOT EXISTS unaccent;
\echo '--- Lexemas segun tratamiento de acentos ---'
SELECT p AS palabra,
       to_tsvector('spanish', p)::text AS solo_spanish,
       to_tsvector('spanish', unaccent(p))::text AS unaccent_y_spanish
FROM unnest(ARRAY['instalación','instalacion','instalar','instalaciones','configuración','configuracion','configurar','descripción','descripcion','documentación','documentacion','arquitectura','indexación','indexacion']) p;

\echo '--- Coincidencias cruzadas: texto con acento contra consulta con y sin acento ---'
SELECT texto, consulta,
  (to_tsvector('spanish', texto) @@ plainto_tsquery('spanish', consulta)) AS solo_spanish,
  (to_tsvector('spanish', unaccent(texto)) @@ plainto_tsquery('spanish', unaccent(consulta))) AS unaccent_y_spanish
FROM (VALUES
  ('La instalación del servicio', 'instalación'),
  ('La instalación del servicio', 'instalacion'),
  ('La instalación del servicio', 'instalar'),
  ('La instalacion del servicio', 'instalación'),
  ('La instalacion del servicio', 'instalar'),
  ('Guía de configuración', 'configuracion'),
  ('Guía de configuración', 'configurar'),
  ('Guia de configuracion', 'configuración')
) t(texto, consulta);
