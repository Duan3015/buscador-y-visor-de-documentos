import { PAGE_SIZE } from './constants';

export function totalPagesFor(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / PAGE_SIZE);
}

export function offsetFor(page: number): number {
  return (page - 1) * PAGE_SIZE;
}
