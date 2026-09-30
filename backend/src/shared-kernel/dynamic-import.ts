/**
 * Import dinamico real. Los modulos ES (pg-boss, pdfjs-dist) no se pueden cargar con require
 * desde el codigo CommonJS que genera TypeScript, ni desde Jest sin transformacion.
 * Con Function el import dinamico queda intacto en la salida compilada.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
export const dynamicImport = new Function('specifier', 'return import(specifier)') as <T = unknown>(
  specifier: string,
) => Promise<T>;
