# Benchmark de la búsqueda por la API (ADR-13)

Mide el camino completo que ve el usuario (NestJS, Drizzle, `total`, resaltado y serialización) con 5.000 documentos indexados por la propia aplicación. Complementa la evidencia de la base de datos de `docs/evidence/fts-capacity/`.

Estado: **la primera medición (sección 4) NO CUMPLE el criterio de aceptación** (p95 menor o igual a 1.000 ms). Tras aplicar dos correcciones (sección 6), **la segunda medición (sección 7) CUMPLE** con un peor p95 de 491,7 ms. El documento conserva ambas corridas, el diagnóstico y las correcciones.

## 1. Entorno

- Máquina: Windows 10.0.26100, Intel Core i5-12450H (12 hilos lógicos), 24 GB de memoria.
- PostgreSQL 17 (`postgres:17-alpine`) en Docker con la configuración por defecto (`shared_buffers` 128 MB, `work_mem` 4 MB, `jit` activo).
- API compilada (`dist/main.js`, `APP_ROLE=all`, concurrencia del worker 2), cliente de medición y base de datos en la misma máquina. Durante las corridas había otras aplicaciones abiertas (editor y navegador).
- Las cifras son de una sola máquina y una sola corrida; no son un dato de producción.

## 2. Conjunto de datos

- 5.000 documentos de perfil mixto generados a partir de seis libros de dominio público en español (Project Gutenberg), cargados por `POST /api/documents`. Los libros no se incluyen en el repositorio.
- Longitud indexada: mediana de 13.292 caracteres, percentil 90 de 89.064 y máximo de 295.180. 431 documentos (8,6 %) están en el tope de 300.000 caracteres. Ninguno quedó con indexación parcial.
- Tamaño: 87 MB de vectores, 117 MB de texto y 15 MB de índice GIN.
- Corpus literario, con términos muy repetidos entre documentos: más coincidencias por consulta que un corpus técnico real (misma limitación que en ADR-03).

## 3. Método

- Comando: `npm run bench:search -- --count 5000` (carga) y `--skip-load` (medición).
- Siete consultas, con 1 y con 5 clientes concurrentes, 10 solicitudes de calentamiento y 100 muestras por consulta.
- Criterio de aceptación de ADR-13: p95 menor o igual a 1.000 ms en todas las consultas y concurrencias.
- Datos crudos: `results/resultados.json` y `results/muestras.jsonl`. Contienen **solo la segunda corrida** (el comando sobrescribe los archivos); de la primera corrida se conservan las tablas de la sección 4, transcritas antes de sobrescribirlos.

### Incidencia de la carga (limitación de la corrida)

La primera ejecución completa (la carga de los 5.000 documentos, previa a ambas mediciones) terminó con error: el cargador espera como máximo 30 minutos a que el worker indexe los documentos y no alcanzó. Los 5.000 documentos se aceptaron en 26 segundos y el worker los indexó en 42 minutos (unos 2 documentos por segundo con concurrencia 2, medido de `created_at` a `indexed_at`); hubo 0 documentos en `ERROR`. La medición se ejecutó después con `--skip-load`, por lo que `resultados.json` tiene `load: null`. Durante parte de la indexación se ejecutaron en la misma máquina las pruebas unitarias, las de integración y una compilación, lo que pudo alargarla; la medición de latencia se hizo con el equipo en reposo.

## 4. Resultados de la primera corrida (antes de las correcciones)

Latencia en milisegundos.

| Consulta | Coincidencias | Clientes | p50 | p95 | p99 | Máximo |
| :-- | --: | --: | --: | --: | --: | --: |
| palabra frecuente (`caballero`) | 2.288 | 1 | 586,5 | 735,8 | 841,8 | 1.011,2 |
| palabra rara (`aldonza`) | 115 | 1 | 358,4 | 401,2 | 447,0 | 448,5 |
| frase entre comillas (`"don quijote"`) | 1.504 | 1 | 577,1 | 748,9 | 860,4 | 1.398,9 |
| con tilde (`ínsula`) | 578 | 1 | 517,2 | 594,8 | 617,8 | 723,2 |
| varias palabras (`amor tiempo caballero`) | 1.416 | 1 | 597,2 | 969,5 | 1.183,4 | 1.381,8 |
| sin resultados | 0 | 1 | 157,0 | 189,0 | 205,6 | 242,5 |
| página 20 (`caballero`) | 2.288 | 1 | 417,5 | 461,0 | 508,1 | 697,1 |
| palabra frecuente | 2.288 | 5 | 794,3 | 898,2 | 910,2 | 990,4 |
| palabra rara | 115 | 5 | 528,6 | 603,5 | 632,6 | 652,1 |
| frase entre comillas | 1.504 | 5 | 886,3 | **1.242,7** | 1.735,6 | 1.765,2 |
| con tilde | 578 | 5 | 769,3 | 878,4 | 884,2 | 885,8 |
| varias palabras | 1.416 | 5 | 883,8 | **1.000,6** | 1.008,4 | 1.046,7 |
| sin resultados | 0 | 5 | 143,6 | 169,5 | 176,2 | 185,2 |
| página 20 | 2.288 | 5 | 567,7 | 645,7 | 710,0 | 710,4 |

**Veredicto: NO CUMPLE.** Peor p95 de 1.242,7 ms (frase entre comillas, 5 clientes); "varias palabras" con 5 clientes queda en 1.000,6 ms.

Con un solo cliente todos los p95 están por debajo de 1.000 ms (el peor, 969,5 ms), pero con margen mínimo: el p99 de "varias palabras" es 1.183 ms y hay máximos de 1.399 ms. Es decir, con un cliente el criterio se cumple por muy poco y con cinco no se cumple.

## 5. Diagnóstico

Scripts y salidas en `diagnostico/`.

1. **El índice GIN no se usa.** El plan de ejecución de la consulta real (`00-plan-de-la-consulta-actual`) es un recorrido secuencial de `document_contents` que evalúa `@@` sobre los 5.000 vectores. Incluso una consulta sin resultados cuesta unos 125 ms de CPU. Con el índice forzado, la misma comprobación tarda 2,6 ms (`01-uso-del-indice`). El planificador prefiere el recorrido secuencial porque la tabla principal ocupa solo 71 páginas (los vectores y el texto viven en TOAST) y subestima el costo de evaluar cada vector. Además, con el `tsquery` en un CTE unido por `CROSS JOIN` o en una subconsulta escalar, el planificador no puede usar el índice ni con el recorrido secuencial desactivado.
2. **Este defecto no se había visto antes:** la evidencia de `fts-capacity` midió tiempos, pero nunca inspeccionó el plan de ejecución. Se asumió que la existencia del índice implicaba su uso.
3. **El resaltado de la página es el costo dominante con términos frecuentes.** Con `caballero`, `ts_headline` sobre los 10 documentos de la página cuesta entre 350 y 450 ms cuando los documentos son largos, y crece con la longitud del texto y con el número de apariciones del término. El cálculo de relevancia de las 2.288 coincidencias añade unos 165 ms (`ts_rank` no es más barato que `ts_rank_cd`).
4. **Con 5 clientes empeora por competencia de CPU:** cada solicitud consume CPU (recorrido secuencial más resaltado), y con cinco simultáneas en una máquina compartida con el cliente y la base de datos el p50 sube de 586 a 794 ms.

## 6. Correcciones aplicadas

Mediciones preliminares en la base de datos (`diagnostico/02-forma-de-consulta-y-ventana-de-resaltado`), consulta `caballero`, sin HTTP:

| Variante | Sin resultados | `caballero` |
| :-- | --: | --: |
| Consulta actual | unos 125 ms | 627 a 835 ms |
| Ids coincidentes en un CTE materializado y `SET LOCAL enable_seqscan = off` en la transacción de búsqueda | unos 1 ms | 536 a 698 ms |
| Lo anterior más resaltado limitado a los primeros 100.000 caracteres | unos 1 ms | 325 a 337 ms |

- **Corrección A (implementación):** la consulta obtiene los ids coincidentes en un CTE materializado con `search_vector @@ websearch_to_tsquery(...)` escrito en línea, y la transacción de búsqueda ejecuta `SET LOCAL enable_seqscan = off` para que el planificador use el índice GIN. Elimina unos 110 a 125 ms de CPU por solicitud en todas las consultas. La prueba de integración `usa el indice GIN...` (`backend/test/integration/read.spec.ts`) verifica que el plan contiene `document_contents_search_vector_idx` y no un recorrido secuencial de `document_contents`.
- **Corrección B (decisión de diseño):** el resaltado se calcula solo sobre los primeros `MAX_HIGHLIGHT_CHARS` caracteres (100.000 por defecto). Reduce alrededor de un 45 % la latencia de los términos frecuentes. Costo: en documentos largos, una coincidencia que solo aparezca después del límite no muestra fragmento (el documento sigue apareciendo en los resultados, como ya ocurre con las coincidencias solo en metadatos). La prueba de integración `resalta solo dentro de la ventana inicial...` verifica ese comportamiento.

## 7. Resultados de la segunda corrida (con las correcciones A y B)

Mismo conjunto de datos, mismas consultas, misma máquina y mismo método que la sección 4; API recompilada y reiniciada, equipo sin otra carga. Latencia en milisegundos; datos crudos en `results/resultados.json`.

| Consulta | Coincidencias | Clientes | p50 | p95 | p99 | Máximo |
| :-- | --: | --: | --: | --: | --: | --: |
| palabra frecuente (`caballero`) | 2.288 | 1 | 248,7 | 296,3 | 320,4 | 327,6 |
| palabra rara (`aldonza`) | 115 | 1 | 108,0 | 132,8 | 154,8 | 158,2 |
| frase entre comillas (`"don quijote"`) | 1.504 | 1 | 300,4 | 342,3 | 372,9 | 373,8 |
| con tilde (`ínsula`) | 578 | 1 | 169,7 | 198,4 | 230,5 | 351,7 |
| varias palabras (`amor tiempo caballero`) | 1.416 | 1 | 265,7 | 318,1 | 354,7 | 373,1 |
| sin resultados | 0 | 1 | 4,6 | 6,1 | 6,6 | 11,2 |
| página 20 (`caballero`) | 2.288 | 1 | 204,0 | 230,9 | 256,0 | 276,6 |
| palabra frecuente | 2.288 | 5 | 329,8 | 396,5 | 447,2 | 457,1 |
| palabra rara | 115 | 5 | 151,3 | 166,2 | 174,0 | 179,1 |
| frase entre comillas | 1.504 | 5 | 405,2 | 491,7 | 503,7 | 507,9 |
| con tilde | 578 | 5 | 240,3 | 292,9 | 304,7 | 308,0 |
| varias palabras | 1.416 | 5 | 364,7 | 430,5 | 443,5 | 443,9 |
| sin resultados | 0 | 5 | 12,1 | 15,6 | 16,6 | 18,9 |
| página 20 | 2.288 | 5 | 277,4 | 306,0 | 315,4 | 316,7 |

**Veredicto: CUMPLE.** Peor p95 de 491,7 ms (frase entre comillas, 5 clientes) frente al umbral de 1.000 ms; el peor máximo observado es 507,9 ms. Comparado con la primera corrida, el peor p95 baja de 1.242,7 a 491,7 ms y la consulta sin resultados de unos 157 ms a 4,6 ms (ya no recorre la tabla).

Alcance de la afirmación:

- Es una medición de una sola máquina, una corrida de 100 muestras por consulta y 5 clientes; no es un dato de producción ni permite extrapolar más allá de lo indicado en `docs/architecture.md`, sección 8.
- El corpus es literario y repite mucho los términos entre documentos, por lo que el número de coincidencias por consulta es probablemente mayor que en un corpus técnico real (misma limitación que en ADR-03).
- La ventana de resaltado de 100.000 caracteres es un compromiso de latencia, no una propiedad de la base de datos; su efecto sobre la calidad del fragmento solo se ha verificado con pruebas funcionales.

## 8. Origen (IA) y validación humana

- El script del benchmark, las consultas de diagnóstico y este informe se elaboraron con asistencia de IA. Las cifras provienen de la ejecución real; las tablas de las secciones 4 y 7 se transcribieron de `results/resultados.json` (la sección 4 antes de que se sobrescribiera).
- La IA que diseñó la búsqueda no verificó el plan de ejecución en ADR-03; el defecto apareció al contrastar el benchmark de la API con las mediciones de la base de datos, en particular por el costo fijo de unos 100 ms de una consulta sin resultados.
- El responsable del proyecto aprobó las correcciones A y B antes de repetir la corrida.
