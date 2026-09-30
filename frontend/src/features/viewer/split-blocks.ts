/** Tamano objetivo de cada bloque de contenido del visor (ADR-12). */
export const BLOCK_TARGET_CHARS = 20_000;

/** Un bloque nunca supera el objetivo por este factor, salvo dentro de una cerca de codigo. */
const HARD_LIMIT_FACTOR = 1.5;

const FENCE = /^\s{0,3}(```|~~~)/;

/** Corta una linea muy larga en piezas de a lo sumo `size` caracteres, preferentemente tras un espacio. */
function splitLongLine(line: string, size: number): string[] {
  const pieces: string[] = [];
  let rest = line;
  while (rest.length > size) {
    const window = rest.slice(0, size);
    const space = window.lastIndexOf(' ');
    // Evita piezas diminutas: solo corta en espacio si queda al menos la mitad del bloque.
    let cut = space >= size / 2 ? space + 1 : size;
    // No separa un par sustituto (caracter fuera del plano basico) por la mitad.
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  pieces.push(rest);
  return pieces;
}

/**
 * Divide el contenido en bloques de aproximadamente `target` caracteres, cortando en limite de
 * parrafo (linea en blanco). En Markdown nunca corta dentro de una cerca de codigo, incluidas sus
 * lineas de apertura y cierre. La concatenacion de los bloques reproduce exactamente el contenido.
 */
export function splitIntoBlocks(content: string, options: { markdown?: boolean; target?: number } = {}): string[] {
  const target = options.target ?? BLOCK_TARGET_CHARS;
  const hardLimit = target * HARD_LIMIT_FACTOR;
  if (content.length <= target) return content === '' ? [] : [content];

  const blocks: string[] = [];
  let current = '';
  let inFence = false;

  const flush = () => {
    if (current !== '') blocks.push(current);
    current = '';
  };

  const lines = content.split('\n');
  lines.forEach((line, index) => {
    const terminated = index < lines.length - 1 ? `${line}\n` : line;
    const isFence = Boolean(options.markdown) && FENCE.test(line);
    // Una cerca nueva que abre con el bloque ya lleno empieza en un bloque propio.
    if (isFence && !inFence && current.length >= target) flush();
    // Apertura, interior y cierre de la cerca forman una unidad indivisible.
    const guarded = inFence || isFence;

    const pieces = !guarded && terminated.length > hardLimit ? splitLongLine(terminated, target) : [terminated];
    for (const piece of pieces) {
      if (!guarded && current !== '' && current.length + piece.length > hardLimit) flush();
      current += piece;
      const atParagraphEnd = line.trim() === '' && pieces.length === 1;
      if (!guarded && current.length >= target && (atParagraphEnd || pieces.length > 1)) flush();
    }

    if (isFence) inFence = !inFence;
  });
  flush();
  return blocks;
}
