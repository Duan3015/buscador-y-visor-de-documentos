# Evidencia de capacidad de la búsqueda de texto completo

Esta carpeta contiene las mediciones que sustentan el límite de indexación de ADR-03 en `docs/architecture.md`. Todas las cifras del documento provienen de estos scripts y de sus resultados en `results/`.

## Origen de la medición

Consulta hecha a la IA (ver también `docs/ia.md`): "Dado un texto en español, ¿cuántos caracteres o páginas puede tener un documento para indexarlo con un único `tsvector` de PostgreSQL sin dividirlo en chunks, y qué se pierde al pasar ese límite?".

En lugar de aceptar una respuesta teórica, se pidió medirlo. Validación humana: los scripts se revisaron antes de ejecutarse, se repitieron las mediciones (los resultados coinciden entre ejecuciones) y una cifra que la IA había enunciado con imprecisión (tamaño del corpus) se corrigió con el dato medido.

## Entorno de la medición

- PostgreSQL 17 (imagen `postgres:17-alpine`) en un contenedor Docker desechable, configuración por defecto.
- Un solo cliente, sin concurrencia. Ejecución en la máquina de desarrollo.
- Corpus: 6 libros en español de Project Gutenberg, 6.816.083 caracteres en total (Don Quijote, La Regenta, Viajes de un Colombiano en Europa, Los cuatro jinetes del apocalipsis, La Divina Comedia, Niebla).
- Configuración de texto: `spanish`.

## Cómo reproducirlo

1. Descargar los textos desde `https://www.gutenberg.org/cache/epub/<ID>/pg<ID>.txt` para los identificadores 2000, 17073, 14329, 24536, 57303 y 49836. Conservar solo el texto entre las marcas `*** START` y `*** END`, guardarlo en UTF-8 sin BOM como `book<ID>.txt`.
2. Levantar PostgreSQL: `docker run -d --name kata-pg-probe -e POSTGRES_PASSWORD=probe -e POSTGRES_DB=probe postgres:17-alpine`.
3. Copiar los archivos de texto y los scripts al contenedor (`docker cp ... kata-pg-probe:/tmp/`).
4. Ejecutar en orden, con `docker exec kata-pg-probe psql -U postgres -d probe -X -q -f /tmp/<script>`:
   - `01-setup.sql`
   - `02-density-and-vector-size.sql`
   - `03-positions-and-highlight.sql`
   - `04-verify-cap.sql` con `-v cap=300000 -v ndocs=1500` y luego con `-v cap=500000 -v ndocs=900`.
5. Eliminar el contenedor: `docker rm -f kata-pg-probe`.

## Resultados

### 1. Densidad del texto

- Entre 5,46 y 6,12 caracteres por palabra.
- Entre 1,016 y 1,046 bytes por carácter en UTF-8.

### 2. Tamaño del vector (texto natural)

- 6,8 millones de caracteres (todo el corpus): 343.712 bytes con 21.683 lexemas. Muy por debajo del límite de 1.048.575 bytes.
- 100.000 caracteres: 45.594 bytes. 1.000.000: 114.056 bytes.

### 3. Peor caso (tokens únicos de 32 caracteres)

- 25.000 tokens (824.999 caracteres): 1.013.376 bytes, aún dentro del límite.
- 30.000 tokens (989.999 caracteres): error `string is too long for tsvector (1088564 bytes, max 1048575 bytes)`.

### 4. Tope de posiciones (16.383)

- La palabra 16.383 se alcanza hacia el carácter 89.443, unas 34 páginas (con 2.600 caracteres por página, supuesto no medido).
- Una frase de dos palabras adyacentes se encontró en el vector completo en los desplazamientos de 20.000, 60.000 y 90.000 caracteres, y no se encontró en los de 500.000 y 1.000.000. En una ventana de 20.000 caracteres alrededor sí se encontró en todos los casos.

### 5. Costo del resaltado (`ts_headline`) por documento

- 100.000 caracteres: 10,9 ms.
- 300.000: 31,0 ms.
- 500.000: 56,0 ms.
- 1.000.000: 104,2 ms.
- 2.000.000: 206,6 ms.
- El costo del ranking sobre un vector ya calculado es despreciable (0,05 ms).

### 6. Verificación del tope (todos los documentos miden exactamente el tope: peor caso)

Latencia de una búsqueda de 10 resultados: ranking y resaltado del texto completo de esos 10. Percentiles sobre 20 ejecuciones por consulta.

Tope de 300.000 caracteres (1.500 documentos, 440 MB de texto, índice GIN de 13 MB):

- Solo ranking: p95 entre 48,7 y 141,4 ms.
- Ranking más resaltado: p50 entre 363,1 y 435,1 ms; p95 entre 412,8 y 607,4 ms; máximo 636,2 ms.

Tope de 500.000 caracteres (900 documentos, 440 MB de texto, índice GIN de 11 MB):

- Solo ranking: p95 entre 129,9 y 381,8 ms.
- Ranking más resaltado: p50 entre 655,6 y 832,2 ms; p95 entre 768,7 y 1.700,4 ms; máximo 1.816,5 ms.

### 7. Acentos, lematizacion y configuracion elegida (mediciones 5 a 11)

- **Medicion 7 (`07-accent-stemming.sql`):** con `unaccent` antes de `spanish`, los sustantivos en "-cion" en singular no se reducen a su raiz; sin `unaccent`, una consulta sin tilde no encuentra el texto con tilde.
- **Medicion 9 (`09-config-comparison.sql`):** compara cuatro configuraciones (A `spanish` con `unaccent`, B `simple` con `unaccent`, C `spanish`, D vector doble) sobre seis documentos y trece consultas. B no encuentra plurales; C no encuentra una palabra escrita sin tilde ("configuracion" sin resultados); A encuentra siempre la palabra exacta con o sin tilde y los plurales comunes; D agrega los sustantivos en "-cion".
- **Medicion 10 (`10-unaccent-config.sql`):** la configuracion propia `es_unaccent` (unaccent seguido de spanish_stem) produce los mismos resultados que A, y `ts_headline` con ella resalta palabras acentuadas conservando las tildes; con `spanish` y `unaccent(consulta)` el resaltado falla. Consultas hostiles: ninguna produce error de sintaxis.
- **Medicion 11 (`11-verify-es-unaccent.sql`):** verificacion del tope con `es_unaccent`. Vector promedio de 81 kB, indice GIN de 14 MB, ranking mas resaltado con p95 entre 476 y 554 ms y maximo de 617 ms con la cache caliente. La primera consulta tras construir el indice dio p95 de 787 ms con la cache fria y de 474 a 501 ms en dos repeticiones. La repeticion de la medicion base (`results/04-verify-cap-300000-repeticion.txt`) dio p95 entre 413 y 541 ms.
- **Medicion 5 (`05-verify-dual-vector.sql`) y medicion 8 (`08-dual-sanity.sql`):** alternativa descartada (vector doble): vector de 86 kB, indice de 14 MB, p95 entre 465 y 550 ms. Se conserva como evidencia de la alternativa.
- **Medicion 6 (`06-count-cost.sql`):** `count(*)` de coincidencias: 0,1 a 0,6 ms con la cache caliente; hasta 141 ms en la primera ejecucion (medido sobre el vector doble).
- **Origen (IA) y validacion humana:** las consultas se plantearon con asistencia de IA a partir de la duda "la configuracion `spanish` con `unaccent` conserva la busqueda por raiz y el resaltado?". La ejecucion mostro que no conserva la raiz de los sustantivos en "-cion" y que rompe el resaltado con la funcion; el responsable del proyecto cuestiono si la busqueda por relacionados es un requisito del enunciado (no lo es), y se eligio la opcion mas simple que cumple: una sola configuracion propia, sin vector doble.
- **Limitaciones:** las mediciones 5 y 11 usan el prefijo de 300.000 caracteres sin pesos de titulo y metadatos (agregan pocos lexemas); las pruebas de humo son de pocos documentos y no miden calidad de relevancia.

## Limitaciones

- Corpus literario, no técnico. El vocabulario técnico (identificadores, código, tablas) cambia la relación entre texto y lexemas; por eso se midió también el peor caso.
- Los documentos son rebanadas aleatorias de un corpus de 6,8 millones de caracteres, con alta superposición: hay más documentos coincidentes por consulta que en un corpus real. Es un escenario conservador para el ranking.
- 900 a 4.000 documentos, no 100.000. El costo del ranking crece con el número de documentos coincidentes, no con el tamaño total del corpus.
- Un solo cliente, sin concurrencia, con configuración por defecto de PostgreSQL. Los valores absolutos dependen de la máquina; lo que se valida es la relación entre tamaño de documento y latencia.
- Las páginas se calculan con un supuesto de 2.600 caracteres por página; depende de la maquetación del documento real.
