-- Configuracion de busqueda propia (ADR-03): quita acentos y luego aplica el lematizador de espanol.
-- Se edita a mano porque drizzle-kit no genera extensiones ni configuraciones de busqueda.
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION es_unaccent (COPY = spanish);
--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION es_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, spanish_stem;
