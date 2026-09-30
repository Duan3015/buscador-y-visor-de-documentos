import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixtures, generateFixtures } from '../../test/fixtures/generate';

describe('generateFixtures', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fixtures-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('escribe un archivo por cada ejemplo y es determinista', () => {
    const written = generateFixtures(dir);

    expect(readdirSync(dir).sort()).toEqual(written.map((fixture) => fixture.name).sort());
    for (const fixture of written) {
      expect(readFileSync(join(dir, fixture.name)).equals(fixture.content)).toBe(true);
    }
    const again = buildFixtures();
    expect(again.map((fixture) => fixture.content.toString('hex'))).toEqual(written.map((fixture) => fixture.content.toString('hex')));
  });

  it('cubre los casos de borde del catalogo: sin texto, danado, cifrado, muchas paginas, no UTF-8, vacio y falso', () => {
    const names = buildFixtures().map((fixture) => fixture.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'escaneado-sin-texto.pdf',
        'danado.pdf',
        'cifrado.pdf',
        'muchas-paginas.pdf',
        'latin1.txt',
        'vacio.txt',
        'falso.pdf',
        'markdown-con-html.md',
      ]),
    );
  });

  it('los PDF validos empiezan con la firma %PDF y el vacio tiene cero bytes', () => {
    const byName = new Map(buildFixtures().map((fixture) => [fixture.name, fixture.content]));

    expect(byName.get('manual-con-texto.pdf')?.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(byName.get('vacio.txt')?.length).toBe(0);
    expect(byName.get('falso.pdf')?.subarray(0, 4).toString('latin1')).not.toBe('%PDF');
  });
});
