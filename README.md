# Buscador y Visor de Documentos Tecnicos

MVP para cargar documentos tecnicos (TXT, PDF y Markdown), indexarlos de forma asincrona, buscarlos por palabra clave o frase con resaltado y leerlos en pantalla, con el estado de indexacion actualizado en tiempo real sin polling.

Documentacion de apoyo:

- [docs/architecture.md](docs/architecture.md): decisiones de arquitectura (ADR-01 a ADR-15), modelo de datos, contratos y casos de borde.
- [docs/ia.md](docs/ia.md): uso de inteligencia artificial y validacion humana.
- [docs/evidence/](docs/evidence): mediciones que sustentan las decisiones, incluido el benchmark de busqueda.

## Vista general

| Pieza | Tecnologia |
| --- | --- |
| Backend (API y worker) | NestJS 11, TypeScript, Drizzle ORM, pg-boss |
| Base de datos y cola | PostgreSQL 17 (busqueda de texto completo, cola de trabajos y LISTEN/NOTIFY) |
| Frontend | Next.js 16 (App Router), React 19, TanStack Query, Tailwind 4 |
| Contratos compartidos | `packages/shared` (esquemas Zod usados por backend y frontend) |
| Pruebas | Jest (unitarias e integracion), Supertest, Testing Library |

Un solo PostgreSQL cubre datos, indice de busqueda, cola y notificaciones. El backend es un monolito modular que puede ejecutarse como `api`, `worker` o `all` (por defecto) segun `APP_ROLE`.

## Requisitos previos

- Node.js 22.13 o superior y npm. Compruebe la version activa con `node -v`: con una version anterior la instalacion advierte o el backend no arranca.
- Docker con Docker Compose (solo para PostgreSQL).

## Puesta en marcha

Desde la raiz del repositorio:

```bash
# 1. Variables de entorno
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# 2. Dependencias (workspaces: packages/shared, backend, frontend)
npm install

# 3. PostgreSQL (espera a que este saludable)
npm run db:up

# 4. Esquema de base de datos (compila packages/shared y aplica migraciones)
npm run db:migrate

# 5. API en el puerto 3001 y frontend en el puerto 3000
npm run dev
```

En PowerShell reemplace `cp` por `Copy-Item`.

Abra la aplicacion en **http://localhost:3000**. Use exactamente ese host: el backend solo admite ese origen por CORS (`CORS_ORIGIN`), de modo que abrir `http://127.0.0.1:3000` haria fallar las llamadas del navegador. Si necesita otro origen, ajuste `CORS_ORIGIN` en `backend/.env`.

Para detener PostgreSQL: `npm run db:down` (los datos se conservan en el volumen; agregue `-v` a `docker compose down` para borrarlos).

## Scripts

Todos se ejecutan desde la raiz.

| Comando | Descripcion |
| --- | --- |
| `npm run dev` | API y frontend en modo desarrollo |
| `npm run dev:api` / `npm run dev:web` | Solo la API o solo el frontend |
| `npm run build` | Compila shared, backend y frontend |
| `npm run db:up` / `db:down` / `db:migrate` | Gestion de PostgreSQL y migraciones |
| `npm run test` | Pruebas unitarias de shared, backend y frontend |
| `npm run test:integration` | Pruebas de integracion del backend (requieren PostgreSQL levantado) |
| `npm run test:cov` | Pruebas unitarias con reporte de cobertura |
| `npm run seed:demo` | Carga un conjunto pequeno de documentos de demostracion por la API |
| `npm run bench:search` | Benchmark de busqueda (ver mas abajo) |
| `npm run docs:purge-errors` | Elimina documentos en ERROR (simulacro por defecto; `-- --confirm` para ejecutar) |
| `npm run fixtures:generate` | Regenera los archivos de prueba de `backend/test/fixtures/files/` |

## Variables de entorno

Los valores comentados de cada variable estan en [backend/.env.example](backend/.env.example) y [frontend/.env.example](frontend/.env.example). Las principales:

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexion a PostgreSQL (el compose expone el puerto 5433 del host) |
| `STORAGE_DIR` | Carpeta de los archivos originales |
| `CORS_ORIGIN` | Unico origen permitido |
| `APP_ROLE` | `api`, `worker` o `all` |
| `MAX_UPLOAD_BYTES_TEXT`, `MAX_UPLOAD_BYTES_PDF`, `MAX_PDF_PAGES` | Limites de carga |
| `MAX_INDEXABLE_CHARS` | Tope de texto indexado por documento |
| `MAX_HIGHLIGHT_CHARS` | Caracteres iniciales de cada documento sobre los que se resaltan los fragmentos de la busqueda |
| `WORKER_CONCURRENCY`, `JOB_RETRY_LIMIT` | Procesamiento asincrono |
| `MAX_SSE_CLIENTS` | Conexiones de tiempo real simultaneas |
| `NEXT_PUBLIC_API_URL` | URL de la API que usa el navegador |

## Pruebas

```bash
npm run test               # unitarias (no requieren base de datos)
npm run test:integration   # requiere `npm run db:up`; usa la base docs_test
npm run test:cov           # cobertura
```

- Backend: la cobertura de dominio, aplicacion y utilidades compartidas tiene umbral (80 % lineas, 70 % ramas) y falla la ejecucion si no se cumple.
- Las pruebas de integracion crean y migran su propia base `docs_test`, y se ejecutan un archivo por proceso para aislar la conexion a la base y la cola.
- Frontend: pruebas de componentes con Testing Library y un `EventSource` simulado. No hay pruebas E2E en navegador; el recorrido completo se valida con la guia de demostracion.

## Guia de demostracion

1. `npm run db:up`, `npm run db:migrate`, `npm run dev`.
2. En otra terminal, `npm run seed:demo` para tener documentos de ejemplo indexados.
3. Antes de la demo, ejecute una busqueda cualquiera para calentar la cache de PostgreSQL (la primera consulta tras un arranque en frio es mas lenta).
4. Recorrido sugerido:
   - **Carga**: en `/upload` arrastre varios archivos de `backend/test/fixtures/files/`. Cada uno muestra PROCESANDO y pasa a INDEXADO o ERROR en vivo, sin recargar.
   - **Errores controlados**: `escaneado-sin-texto.pdf` (sin texto), `danado.pdf`, `cifrado.pdf`, `muchas-paginas.pdf`, `latin1.txt` terminan en ERROR con un mensaje explicativo; `vacio.txt` y `falso.pdf` se rechazan al cargar.
   - **Busqueda**: en `/` busque una palabra, una frase entre comillas y un termino con o sin tilde. Se resaltan las coincidencias y se pagina el resultado.
   - **Visor**: abra un resultado; el contenido se muestra por bloques, sin opcion de descarga. `markdown-con-html.md` demuestra que el HTML embebido no se ejecuta.
   - **Tiempo real**: detenga la API durante la carga y observe el aviso de reconexion; al volver, el estado se reconcilia solo.

## Benchmark de busqueda

```bash
# API en marcha con la base vacia (ver docs/evidence/api-benchmark/README.md)
npm run bench:search -- --count 5000
```

Descarga un corpus en espanol de dominio publico (Project Gutenberg) a `backend/.cache/corpus` (carpeta ignorada por git), genera 5.000 documentos con distintos tamanos, los carga por la API real y mide los tiempos de la busqueda a 1 y 5 clientes concurrentes. El criterio de aceptacion es p95 <= 1000 ms. Resultados y limitaciones en [docs/evidence/api-benchmark/](docs/evidence/api-benchmark).

Si una red corporativa intercepta TLS y la descarga falla con `SELF_SIGNED_CERT_IN_CHAIN`, descargue manualmente los libros `pg<ID>.txt` de Gutenberg a `backend/.cache/corpus/book<ID>.txt` (IDs 2000, 17073, 14329, 24536, 57303 y 49836) y repita el comando.

## Estructura del repositorio

```
backend/            API y worker (NestJS), migraciones, scripts y pruebas
frontend/           Aplicacion Next.js (features: upload, search, viewer, notifications)
packages/shared/    Esquemas y tipos compartidos (Zod)
docs/               Arquitectura, uso de IA y evidencias
docker-compose.yml  PostgreSQL local
```

## Alcance del MVP y limites conocidos

- Sin autenticacion ni multiusuario: fuera del alcance de la prueba.
- Sin descarga de documentos, por requerimiento.
- Se indexan como maximo `MAX_INDEXABLE_CHARS` caracteres por documento; si se supera, el documento queda INDEXADO con aviso de indexacion parcial (ver ADR-03).
- El resaltado de la busqueda se calcula solo sobre los primeros `MAX_HIGHLIGHT_CHARS` caracteres (100.000 por defecto): en un documento largo, una coincidencia posterior a esa ventana lo lista sin fragmento resaltado (el visor muestra el texto completo).
- PDF escaneados sin texto terminan en ERROR (`NO_EXTRACTABLE_TEXT`); no hay OCR.
- Los archivos originales se guardan en disco local (`STORAGE_DIR`); en un despliegue con varias instancias debe sustituirse por almacenamiento compartido mediante el puerto de almacenamiento existente.
