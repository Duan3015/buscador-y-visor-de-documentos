import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildCorruptPdf, buildPdf } from './pdf-builder';

export interface Fixture {
  name: string;
  /** Resultado esperado al cargarlo (ADR-08, ADR-11), para usarlo como guia en pruebas manuales. */
  expected: string;
  content: Buffer;
}

const GUIA_TXT = [
  'Guia de instalacion del servidor',
  '',
  'Este documento describe los pasos para la instalacion del servidor en un entorno de produccion.',
  'Primero se prepara la base de datos y luego se configura la aplicacion.',
  '',
  'Configuracion inicial de la base de datos: cree el usuario, la base y aplique las migraciones.',
  'La conexion se configura mediante la variable DATABASE_URL.',
  '',
  'Verificacion: la aplicacion debe responder en el puerto configurado y mostrar el estado saludable.',
].join('\n');

const NOTAS_MD = [
  '# Notas de arquitectura',
  '',
  'El sistema es un **monolito modular** con dos roles: API y worker.',
  '',
  '## Decisiones',
  '',
  '- Busqueda con PostgreSQL FTS',
  '- Cola con pg-boss',
  '- Tiempo real con SSE',
  '',
  '```sql',
  "SELECT id FROM documents WHERE status = 'INDEXADO';",
  '```',
  '',
  'Consulte la [documentacion](https://example.com/docs) para mas detalle.',
].join('\n');

const MD_CON_HTML = [
  '# Documento con HTML incrustado',
  '',
  'Texto normal antes del contenido peligroso.',
  '',
  '<script>window.__hacked = true</script>',
  '',
  '<img src="x" onerror="window.__hacked = true">',
  '',
  'Texto normal despues del contenido peligroso.',
].join('\n');

/** Construye todos los archivos de ejemplo. Es determinista: la misma llamada produce los mismos bytes. */
export function buildFixtures(): Fixture[] {
  return [
    { name: 'guia-instalacion.txt', expected: '202, luego INDEXADO', content: Buffer.from(GUIA_TXT, 'utf8') },
    { name: 'notas-arquitectura.md', expected: '202, luego INDEXADO', content: Buffer.from(NOTAS_MD, 'utf8') },
    { name: 'markdown-con-html.md', expected: '202, luego INDEXADO; el visor no ejecuta el HTML (E-24)', content: Buffer.from(MD_CON_HTML, 'utf8') },
    {
      name: 'manual-con-texto.pdf',
      expected: '202, luego INDEXADO',
      content: buildPdf({
        pages: [
          'Manual de operacion\nProcedimiento de respaldo de la base de datos',
          'Restauracion de datos\nSe recomienda verificar la integridad del archivo',
          'Contactos de soporte\nEquipo de plataforma',
        ],
      }),
    },
    { name: 'escaneado-sin-texto.pdf', expected: '202, luego ERROR NO_EXTRACTABLE_TEXT', content: buildPdf({ pages: [null, null] }) },
    { name: 'danado.pdf', expected: '202, luego ERROR PDF_CORRUPT', content: buildCorruptPdf() },
    { name: 'cifrado.pdf', expected: '202, luego ERROR PDF_ENCRYPTED', content: buildPdf({ pages: ['secreto'], encrypted: true }) },
    {
      name: 'muchas-paginas.pdf',
      expected: '202, luego ERROR PDF_TOO_MANY_PAGES (con MAX_PDF_PAGES=1000)',
      content: buildPdf({ pages: Array.from({ length: 1001 }, () => null) }),
    },
    {
      name: 'latin1.txt',
      expected: '202, luego ERROR ENCODING_UNSUPPORTED',
      content: Buffer.from('Instalaci\xf3n en codificaci\xf3n Latin-1', 'latin1'),
    },
    { name: 'vacio.txt', expected: '400 EMPTY_FILE', content: Buffer.alloc(0) },
    { name: 'falso.pdf', expected: '415 UNSUPPORTED_MEDIA_TYPE (extension PDF, contenido de texto)', content: Buffer.from('esto no es un pdf', 'utf8') },
  ];
}

/** Escribe los archivos en `dir` y devuelve la lista. */
export function generateFixtures(dir: string): Fixture[] {
  mkdirSync(dir, { recursive: true });
  const fixtures = buildFixtures();
  for (const fixture of fixtures) writeFileSync(join(dir, fixture.name), fixture.content);
  return fixtures;
}

if (require.main === module) {
  const target = resolve(__dirname, 'files');
  for (const fixture of generateFixtures(target)) {
    console.log(`${fixture.name.padEnd(28)} ${String(fixture.content.length).padStart(8)} bytes  ${fixture.expected}`);
  }
  console.log(`Archivos escritos en ${target}`);
}
