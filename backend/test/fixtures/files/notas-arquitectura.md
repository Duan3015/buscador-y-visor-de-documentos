# Notas de arquitectura

El sistema es un **monolito modular** con dos roles: API y worker.

## Decisiones

- Busqueda con PostgreSQL FTS
- Cola con pg-boss
- Tiempo real con SSE

```sql
SELECT id FROM documents WHERE status = 'INDEXADO';
```

Consulte la [documentacion](https://example.com/docs) para mas detalle.