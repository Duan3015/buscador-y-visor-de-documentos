# Uso de inteligencia artificial

Este documento describe cómo se usó la IA en la prueba técnica "Buscador y Visor de Documentos Técnicos", qué produjo, qué se validó y qué corrigió el responsable del proyecto. La regla de trabajo fue una sola: **la IA propone, argumenta y mide; el responsable decide.** Ninguna decisión de `docs/architecture.md` se registró como ADR sin aprobación explícita.

> Estado: la etapa de diseño y documentación está completa. La sección 6 (implementación) se actualiza al generar el código.

## 1. Herramientas

| Herramienta | Uso |
| :-- | :-- |
| Cursor (modo agente) con un modelo de lenguaje de Anthropic (Claude) | Análisis del enunciado, propuesta y comparación de opciones, redacción de ADR, escritura de scripts de medición y edición de documentos. La versión exacta del modelo pudo variar entre sesiones |
| Docker con PostgreSQL 17 desechable | Entorno donde la IA ejecutó las mediciones (contenedores efímeros) |
| Node.js y `pdfjs-dist` | Scripts de medición de extracción de PDF, hash SHA-256 y latencia de eventos |
| Mermaid (analizador oficial) | Validación de sintaxis de los 8 diagramas del documento |
| Repositorio de referencia `ribolost/kata-ecommerce-descuentos` | Prueba similar entregada por el responsable como referencia de formato y de criterios de evaluación |

## 2. Método de trabajo

1. **Análisis primero.** La IA analizó el enunciado y lo convirtió en una checklist de entregables, supuestos y requisitos no funcionales antes de proponer nada.
2. **Una decisión a la vez.** Cada ADR se presentó con opciones evaluadas, justificación técnica breve, ventaja frente a las alternativas y trade-offs. El responsable aprobó, corrigió o rechazó antes de pasar al siguiente.
3. **Validación contra el enunciado.** Cada propuesta se contrastó con los requisitos de la prueba, el tiempo disponible (un día) y el alcance de MVP. Lo que excedía el enunciado se movió a trade-offs, no se convirtió en decisión.
4. **Evidencia antes que opinión.** Donde una decisión dependía de un número (límites de carga, latencia de búsqueda, latencia de eventos, costo del hash), la IA escribió el script, lo ejecutó y guardó el resultado en `docs/evidence/`. Lo que no se midió se declaró como valor de criterio (sección 7.3 de `architecture.md`).

## 3. Casos de uso de la IA por etapa

| Etapa | Qué hizo la IA | Qué produjo | Qué validó el responsable |
| :-- | :-- | :-- | :-- |
| Análisis del enunciado | Extraer requisitos, ambigüedades y criterios de evaluación | Checklist, supuestos (por ejemplo, "400 ms a 1 s" como techo de p95) y tabla de requisitos no funcionales | Interpretación de los supuestos |
| Selección de stack | Comparar backend, frontend, base de datos, cola y ORM | ADR-02 a ADR-05 | Elección final de cada tecnología |
| Motor de búsqueda | Diseñar la indexación y medir capacidad de PostgreSQL FTS | ADR-03 y `docs/evidence/fts-capacity/` (11 mediciones) | Que el límite de 300.000 caracteres saliera de datos; que la búsqueda por términos relacionados no era un requisito |
| Límites de carga | Medir extracción de PDF, lectura de TXT y hash | ADR-03, ADR-06, ADR-10 y `docs/evidence/upload-limits/`, `docs/evidence/sha256-cost/` | Que el SHA-256 solo se adoptara si su costo era bajo |
| Tiempo real | Comparar SSE, WebSocket y GraphQL; medir latencia | ADR-07 y `docs/evidence/realtime-latency/` | Aprobación del canal y de la reconciliación en el cliente |
| Consistencia y errores | Diseñar transiciones, cola de fallidos y catálogo de errores | ADR-08 | Que la causa del error quedara registrada; qué se deja como trade-off |
| Arquitectura, contrato y frontend | Estructura por módulos, API REST, frontend | ADR-09, ADR-11, ADR-12 | Aprobación uno a uno |
| Pruebas, seguridad y entorno | Estrategia de pruebas, manejo de errores y docker-compose | ADR-13, ADR-14, ADR-15 | Que no hubiera autenticación; que CORS se mantuviera simplificado |
| Vistas, trade-offs y escalabilidad | Diagramas, tabla consolidada y capítulo de escalabilidad | Secciones 3, 7 y 8 de `architecture.md` | Aprobación de cada sección |

## 4. Prompts clave y su refinamiento

Los prompts se reproducen de forma literal o resumida. La columna final muestra cómo cambió el resultado.

| Prompt del responsable | Intención | Efecto |
| :-- | :-- | :-- |
| "Actúa como un arquitecto de soluciones de software para analizar la prueba técnica... primero analiza y después la resolvemos." | Separar análisis de resolución | Primera checklist y consideraciones antes de decidir nada |
| "Cada decisión va a ser aprobada, y quiero que me describas las decisiones respondiendo técnicamente por qué se eligió." | Fijar el protocolo de decisión | Formato de ADR con opciones, justificación y trade-offs |
| "Evalúa chunks... confirma pg-boss... explica SHA-256 y duplicados." | Evaluar complejidad frente a beneficio | Chunks documentados como evolución; SHA-256 solo si su costo era bajo |
| "Usa PostgreSQL después de validar peso del texto y chunks como extensión." | Validar con datos | Mediciones de capacidad y tope de 300.000 caracteres |
| "Valida las mejores prácticas... 1. de 10 en 10 la paginación 2. tienes que validarlo y mencionarme cuáles son los valores óptimos... 3. ¿para qué la reindexación?" | Exigir valores medidos y cuestionar el alcance | Valores respaldados por evidencia; reindexado fuera de alcance |
| "No quiero ninguna decisión adicional, si algo lo puedes guardar en los trade-off." | Contener el alcance | Todo extra pasó a trade-offs |
| "Si incluye esas dos columnas, si está alineado con los requerimientos de la prueba, recuerda que es un MVP." | Podar sobrediseño | ADR-10 pasó de dos columnas de contenido a una sola |
| "Se pide buscar relacionados en la prueba técnica, valida si es un requerimiento; y si hay problema con los acentos, ¿es posible quitarlos e indexarlos sin acentos?" | Verificar antes de aprobar el vector doble | Vector doble descartado; se adoptó la configuración `es_unaccent` |
| "¿Por qué existe pageSize si el paginado va a ser por 10?" | Cuestionar un parámetro innecesario | `pageSize` eliminado; `PAGE_SIZE` fijo |
| "No sé si en un entorno local es válido tener en cuenta el CORS; si no vale la pena, es mejor quitarlo." | Cuestionar una medida de seguridad en local | La IA explicó que el navegador exige CORS por el cambio de puerto; se mantuvo simplificado |

## 5. Validación humana y registro de decisiones corregidas

### 5.1 Decisiones rechazadas o ajustadas por el responsable

| Propuesta de la IA | Corrección del responsable | Resultado |
| :-- | :-- | :-- |
| Reindexar documentos como parte del alcance | Preguntó para qué y pidió tratarlo como trade-off si la prueba no lo pide | Fuera de alcance; el enunciado no lo requiere |
| Limpiar los documentos en `ERROR` con una consulta manual | Propuso una consulta y luego prefirió un script | Script `docs:purge-errors` con modo simulación por defecto |
| Registrar el fallo sin causa visible | Pidió dejar la razón por la que un documento quedó en `ERROR` | Columnas de causa del error y motivo en el evento y en el visor |
| Reporte de documentos atascados y limpieza de archivos huérfanos | Pidió dejarlos como trade-offs | Documentados como trade-offs con su evolución |
| Varias decisiones adicionales por ADR | Pidió no añadir decisiones y guardarlas como trade-offs | Alcance contenido |
| Modelo de dos columnas de contenido en ADR-10 | Pidió validar si estaba alineado con el MVP | Una sola columna `content`; `markdown-it` retirado |
| Vector doble con y sin acentos | Preguntó si la búsqueda por relacionados era un requisito | No lo era; vector doble descartado |
| Parámetro `pageSize` | Preguntó por qué existía con paginación fija | Eliminado |
| CORS con lista de orígenes y caso de borde propio | Preguntó si valía la pena en local | Mantenido con un solo origen y sin caso de borde |
| Autenticación | Se propuso no incluirla; el responsable lo aprobó | Trade-off declarado en ADR-14 |

### 5.2 Errores de la IA detectados y corregidos

| Error | Cómo se detectó | Corrección |
| :-- | :-- | :-- |
| Rechazo de PDF con demasiadas páginas en la API con `422`, cuando la API no procesa PDF | Revisión de coherencia entre ADR | El worker marca `ERROR` con `PDF_TOO_MANY_PAGES` |
| Vector de búsqueda como columna generada, incompatible con reducir el prefijo ante el límite del vector | Revisión de coherencia | Vector calculado al insertar |
| Configuración `spanish` con `unaccent(texto)` en cada llamada: nunca fue lo que se midió y rompía el resaltado | Contraste con la medición | Configuración propia `es_unaccent` y nueva medición |
| Código de tiempo agotado distinto entre casos de borde | Revisión de coherencia | Unificado como `EXTRACTION_TIMEOUT` |
| Casos de borde y catálogo con texto de decisiones anteriores (codificación no UTF-8, tamaño de página configurable, estado de patrones) | Revisión final de coherencia | Corregidos en las secciones 5 y 6 de `architecture.md` |
| Cifras de una prueba con 1.000 clientes SSE rechazadas por ráfaga de conexiones | Fallo `ECONNREFUSED` durante la medición | Conexiones en lotes de 50; documentado en la evidencia |
| Texto con acentos corrompido al enviar SQL por la tubería de PowerShell | Salida con caracteres erróneos | Envío del archivo al contenedor y ejecución con `psql -f` |

### 5.3 Controles aplicados a la salida de la IA

- **Medición, no confianza:** los límites y la latencia provienen de scripts ejecutados y guardados, con su origen (IA) y validación humana anotados en cada README de evidencia.
- **Valores no medidos, declarados:** la sección 7.3 de `architecture.md` lista los valores de criterio. Un riesgo conocido sin medición (`NOTIFY` con muchas transacciones por segundo) se redactó como riesgo, no como dato.
- **Sintaxis verificada por herramienta:** los diagramas Mermaid se validaron con el analizador oficial; no se revisaron visualmente en un visor.
- **Coherencia entre secciones:** revisión cruzada de ADR, catálogo de patrones, casos de borde, vistas y capítulos antes de la aprobación global.

## 6. Implementación (se completa al generar el código)

El código lo generará la IA bajo el mismo protocolo. Para cada módulo, el responsable validará antes de aceptarlo:

1. Que cumpla el ADR correspondiente y la checklist de la prueba.
2. Que tenga sus pruebas (unitarias con dobles en memoria e integración con PostgreSQL real, ADR-13) y que estas pasen.
3. Que los casos de borde del catálogo tengan una prueba trazable por identificador.
4. Que no se añadan dependencias ni funciones fuera de alcance.

Esta sección se completará con los prompts de implementación, las correcciones realizadas al código generado y los resultados del benchmark de la API.
