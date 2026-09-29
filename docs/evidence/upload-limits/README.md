# Evidencia: costo de extraccion de texto y limites de carga

Sustenta la tabla de restricciones de ADR-03 en `docs/architecture.md`: `MAX_UPLOAD_BYTES`, `MAX_PDF_PAGES`, `MAX_EXTRACTED_CHARS`, `EXTRACTION_TIMEOUT_MS` y `WORKER_CONCURRENCY`.

## Origen y validacion

- **Origen (IA):** los scripts se generaron con asistencia de IA a partir de la pregunta "que tan costoso es extraer texto de PDF y TXT segun peso, paginas y caracteres, y cual limite de carga es razonable".
- **Validacion humana:** se ejecutaron los scripts, se revisaron las cifras contra el tamano real de los archivos generados y se descarto una primera corrida que fallo por un error de API (`pdf.destroy`). Los resultados aqui son los de la corrida corregida.

## Entorno

Windows, PowerShell, Node LTS, `pdfjs-dist` (compilacion `legacy`, extraccion pagina por pagina con `getTextContent`) y `pdfkit` para generar PDFs sinteticos. Cada archivo se mide en un proceso nuevo para que el pico de memoria (RSS) sea comparable. Linea base del proceso: 69 MB.

## Reproduccion

```
npm install pdfkit pdfjs-dist
node gen.js            # PDFs de texto y un PDF de imagenes de unos 23 MB
node gen-blank.js      # PDFs de 5.000 y 20.000 paginas casi vacias
node extract.mjs pdfs/<archivo>.pdf [maxCaracteres]
node txtbench.mjs      # lectura + SHA-256 + normalizacion de TXT de 1, 3 y 5 MB
```

## Resultados

### PDF, extraccion completa (`results/pdf-extraccion-completa.jsonl`)

Los tiempos varian entre corridas; se reportan los rangos observados en dos corridas.

| PDF | Peso | Paginas | Caracteres | Extraccion | Pico RSS |
| :-- | --: | --: | --: | --: | --: |
| texto-115p | 0,26 MB | 115 | 299.000 | 0,37 a 0,53 s | 116 a 117 MB |
| texto-500p | 1,14 MB | 500 | 1,3 M | 1,4 a 1,9 s | 140 a 141 MB |
| texto-1000p | 2,28 MB | 1.000 | 2,6 M | 2,5 a 3,2 s | 165 a 166 MB |
| imagenes-30p | 22,97 MB | 30 | 78.000 | 0,17 a 0,21 s | 118 a 121 MB |
| casi-vacio-5000p | 2,31 MB | 5.000 | 54.000 | 4,0 a 7,5 s | 164 MB |
| casi-vacio-20000p | 9,33 MB | 20.000 | 229.000 | 40 a 106 s | 249 a 264 MB |

### PDF, parada al alcanzar 300.000 caracteres (`results/pdf-parada-300000.jsonl`)

Los tres PDFs de 250, 500 y 1.000 paginas se detienen tras leer 116 paginas, en 0,4 a 0,6 s, con pico de 116 a 121 MB. El tiempo deja de depender del total de paginas cuando el texto es denso.

### TXT / Markdown (`results/txt-lectura-hash-normalizacion.jsonl`)

Leer, calcular SHA-256 y normalizar (saltos de linea, caracteres nulos, NFC): 8 ms con 1 MB, 16 ms con 3 MB, 33 ms con 5 MB.

## Conclusiones

1. El peso del PDF no predice el costo. Un PDF de 23 MB con 30 paginas se extrae en menos de 0,25 s; uno de 2,3 MB con 1.000 paginas tarda unos 3 s.
2. El costo depende del numero de paginas, no de los megabytes, y crece por encima de lo lineal con decenas de miles de paginas (20.000 paginas: entre 40 y 106 s).
3. La memoria crece con paginas y peso: unos 50 MB por encima de la linea base con un PDF de 23 MB y unos 100 MB con 1.000 paginas.
4. Para TXT y Markdown el costo de CPU es despreciable; el limite de peso responde a coherencia con el tope de texto y al tamano de la respuesta del visor.
5. La extraccion no bloquea el hilo principal por mas de unos 40 a 90 ms seguidos porque cede el control entre paginas. La separacion API y worker se justifica por aislar CPU y memoria, no por evitar un bloqueo continuo del bucle de eventos.

## Limitaciones

- PDFs sinteticos: fuente estandar, sin fuentes incrustadas, tablas complejas ni formularios. Los PDFs reales pueden ser varias veces mas lentos por pagina.
- No se midio concurrencia ni un PDF escaneado con OCR (fuera de alcance).
- Un solo equipo; los tiempos absolutos cambian con el hardware. Lo que se trata como dato son las proporciones y los rangos.
