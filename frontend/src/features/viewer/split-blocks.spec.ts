import { splitIntoBlocks } from './split-blocks';

const paragraph = (label: string, size: number) => `${label} ${'palabra '.repeat(Math.ceil(size / 8))}`.slice(0, size);

describe('splitIntoBlocks', () => {
  it('devuelve una lista vacia para contenido vacio y un solo bloque si es corto', () => {
    expect(splitIntoBlocks('')).toEqual([]);
    expect(splitIntoBlocks('texto corto', { target: 100 })).toEqual(['texto corto']);
  });

  it('corta en limite de parrafo y la concatenacion reproduce el original', () => {
    const content = Array.from({ length: 10 }, (_, n) => paragraph(`P${n}`, 90)).join('\n\n');

    const blocks = splitIntoBlocks(content, { target: 250 });

    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.join('')).toBe(content);
    for (const block of blocks.slice(0, -1)) {
      expect(block.endsWith('\n')).toBe(true);
      expect(block.length).toBeLessThanOrEqual(250 * 1.5);
    }
  });

  it('no parte una cerca de codigo de Markdown aunque supere el tamano objetivo', () => {
    const code = ['```ts', ...Array.from({ length: 30 }, (_, n) => `const linea${n} = ${n};`), '', 'const despues = 1;', '```'].join('\n');
    const content = `${paragraph('Intro', 200)}\n\n${code}\n\n${paragraph('Cierre', 200)}`;

    const blocks = splitIntoBlocks(content, { markdown: true, target: 150 });

    expect(blocks.join('')).toBe(content);
    const holder = blocks.find((block) => block.includes('```ts'));
    expect(holder).toBeDefined();
    expect(holder).toContain('const despues = 1;');
    expect(holder?.match(/```/g)).toHaveLength(2);
  });

  it('en texto plano si corta dentro de lo que parece una cerca', () => {
    const content = ['```', ...Array.from({ length: 40 }, (_, n) => `linea ${n} ${'x'.repeat(20)}`), '```'].join('\n');

    const blocks = splitIntoBlocks(content, { markdown: false, target: 200 });

    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.join('')).toBe(content);
  });

  it('divide un parrafo enorme sin saltos de linea usando los espacios', () => {
    const content = 'palabra '.repeat(1000).trimEnd();

    const blocks = splitIntoBlocks(content, { target: 500 });

    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.join('')).toBe(content);
    for (const block of blocks) expect(block.length).toBeLessThanOrEqual(500 * 1.5);
  });

  it('divide una linea sin espacios y no separa un par sustituto', () => {
    const content = '😀'.repeat(400);

    const blocks = splitIntoBlocks(content, { target: 101 });

    expect(blocks.join('')).toBe(content);
    for (const block of blocks) expect(block).toBe(Array.from(block).join(''));
  });

  it('un bloque nuevo de cerca empieza aparte si el actual ya esta lleno', () => {
    // El bloque supera el objetivo sin haber pasado por una linea en blanco: la cerca abre uno nuevo.
    const content = `${paragraph('Uno', 120)}\n${paragraph('Dos', 120)}\n\`\`\`\ncodigo\n\`\`\`\n`;

    const blocks = splitIntoBlocks(content, { markdown: true, target: 200 });

    expect(blocks.join('')).toBe(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.startsWith('```')).toBe(true);
  });

  it('con el tamano por defecto un texto de 100.000 caracteres da bloques de unos 20.000', () => {
    const content = Array.from({ length: 500 }, (_, n) => paragraph(`P${n}`, 198)).join('\n\n');

    const blocks = splitIntoBlocks(content);

    expect(blocks.join('')).toBe(content);
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    expect(blocks.length).toBeLessThanOrEqual(6);
  });
});
