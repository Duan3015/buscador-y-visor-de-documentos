CREATE OR REPLACE FUNCTION dual(t text) RETURNS tsvector LANGUAGE sql IMMUTABLE AS
$$ SELECT to_tsvector('spanish', t) || to_tsvector('spanish', public.unaccent('public.unaccent'::regdictionary, t)) $$;
CREATE OR REPLACE FUNCTION dualq(q text) RETURNS tsquery LANGUAGE sql IMMUTABLE AS
$$ SELECT websearch_to_tsquery('spanish', q) || websearch_to_tsquery('spanish', public.unaccent('public.unaccent'::regdictionary, q)) $$;

DROP TABLE IF EXISTS d2;
CREATE TABLE d2 (id int, title text, meta text, content text, v tsvector);
INSERT INTO d2 VALUES
 (1, 'Guía de instalación', 'Ana Pérez manuales v1.0', 'Este documento describe el despliegue del servicio en producción.', NULL),
 (2, 'Manual de despliegue', 'Luis Gómez arquitectura v2.0', 'La instalación del servicio requiere configurar variables. Configuración paso a paso.', NULL),
 (3, 'Notas varias', 'Ana Pérez configuracion', 'Contenido sin relación. Se debe instalar el paquete.', NULL);
UPDATE d2 SET v = setweight(dual(title), 'A') || setweight(dual(meta), 'B') || setweight(dual(left(content, 300000)), 'D');
CREATE INDEX d2_gin ON d2 USING gin (v);

SELECT q AS consulta,
       (SELECT string_agg(id::text || ':' || round(ts_rank_cd(v, dualq(q))::numeric, 2)::text, '  ' ORDER BY ts_rank_cd(v, dualq(q)) DESC)
        FROM d2 WHERE v @@ dualq(q)) AS ids_y_rank
FROM (VALUES
  ('instalar'), ('instalacion'), ('instalación'), ('configurar'), ('configuración'),
  ('perez'), ('Pérez'), ('"instalación del servicio"'), ('"instalacion del servicio"'), ('servicio -manual')
) t(q);
