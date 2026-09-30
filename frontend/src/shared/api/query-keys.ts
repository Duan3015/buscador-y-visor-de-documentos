/** Claves de la cache de TanStack Query. Una clave por consulta vigente (E-46). */
export const queryKeys = {
  document: (id: string) => ['document', id] as const,
  search: (q: string, page: number) => ['search', q, page] as const,
};
