# Evidencia: latencia de entrega de eventos de estado (NOTIFY y SSE)

Sustenta ADR-07 en `docs/architecture.md`.

## Origen y validacion

- **Origen (IA):** el script se genero con asistencia de IA a partir de la pregunta "cuanto tarda un evento desde que se confirma el cambio de estado en la base de datos hasta que lo recibe un cliente, y como crece con la cantidad de clientes conectados".
- **Validacion humana:** el primer intento con 1.000 clientes fallo con `ECONNREFUSED` (rafaga de conexiones simultaneas contra el backlog de `listen`); se corrigio en el script conectando en tandas de 50 y el resultado se verifico contando las entregas: 300.000 esperadas y 300.000 recibidas.

## Que mide

Un escritor ejecuta `BEGIN; SELECT pg_notify(...); COMMIT` (300 eventos, uno cada 5 ms) contra PostgreSQL 17 en Docker. Un proceso backend con una conexion dedicada en `LISTEN` reenvia cada notificacion a N clientes SSE. Cada mensaje lleva la hora de emision; la latencia se mide al recibirlo.

## Reproduccion

```
docker run -d --rm --name rt-probe -e POSTGRES_PASSWORD=probe -p 55432:5432 postgres:17-alpine
npm install pg
node rt-bench.mjs <clientesSSE> <eventos>
```

## Resultados (`results/notify-sse-latencia.jsonl`, rangos de dos corridas)

| Clientes SSE | Commit a backend (p95) | Commit a cliente (p95) | Maximo | Memoria del proceso |
| --: | --: | --: | --: | --: |
| 1 | 6,8 ms | 7,3 ms | 8,5 ms | 49 a 54 MB |
| 100 | 4,6 a 4,8 ms | 13,1 a 15,2 ms | 29,5 ms | 54 a 71 MB |
| 1.000 | 12,2 a 19,2 ms | 97 a 162 ms | 310 ms | 78 a 130 MB |

Entregas: sin perdidas en ninguna corrida.

## Limitaciones

- Servidor y clientes comparten un solo proceso y un solo bucle de eventos: el costo de leer y analizar los mensajes de los clientes se suma a la latencia. Las cifras con muchos clientes son conservadoras.
- Sin red real, sin proxy intermedio, una sola instancia, mismo equipo para la base de datos y el proceso.
- No mide la entrega tras una caida de la conexion: `LISTEN/NOTIFY` no reenvia lo perdido; eso lo cubre la reconciliacion descrita en ADR-07.
