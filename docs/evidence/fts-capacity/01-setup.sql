-- Prepara el corpus de prueba: 6 libros en espanol (aprox. 6,8 millones de caracteres).
-- Requiere los archivos /tmp/book<ID>.txt dentro del contenedor (ver README.md).
\pset pager off
CREATE EXTENSION IF NOT EXISTS unaccent;

DROP TABLE IF EXISTS books;
CREATE TABLE books (id int PRIMARY KEY, title text, body text);
INSERT INTO books VALUES
 (2000,  'Quijote',        pg_read_file('/tmp/book2000.txt')),
 (17073, 'Regenta',        pg_read_file('/tmp/book17073.txt')),
 (14329, 'Viajes',         pg_read_file('/tmp/book14329.txt')),
 (24536, 'Jinetes',        pg_read_file('/tmp/book24536.txt')),
 (57303, 'Divina Comedia', pg_read_file('/tmp/book57303.txt')),
 (49836, 'Niebla',         pg_read_file('/tmp/book49836.txt'));

DROP TABLE IF EXISTS corpus;
CREATE TABLE corpus AS
  SELECT string_agg(body, E'\n\n' ORDER BY id) AS body FROM books;

SELECT length(body) AS corpus_chars FROM corpus;
