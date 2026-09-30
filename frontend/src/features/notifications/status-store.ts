import type { DocumentStatus } from '@kata/shared';

export interface TrackedStatus {
  status: DocumentStatus;
  errorCode: string | null;
}

type Listener = () => void;

const PROCESSING: TrackedStatus = { status: 'PROCESANDO', errorCode: null };

/** Eventos de documentos aun no seguidos que se conservan (el canal es global). */
export const EARLY_EVENTS_LIMIT = 200;

/**
 * Estado en memoria de los documentos que el usuario sigue (cola de carga y visor).
 * Compatible con useSyncExternalStore: cada cambio genera un objeto nuevo y notifica.
 *
 * Un documento puede terminar de indexarse antes de que la respuesta 202 de la carga llegue al
 * navegador. Por eso los eventos de documentos no seguidos se guardan en un buffer acotado y se
 * aplican cuando empieza el seguimiento; sin el buffer esa fila quedaria en PROCESANDO para siempre.
 */
export class StatusStore {
  private readonly statuses = new Map<string, TrackedStatus>();
  private readonly early = new Map<string, TrackedStatus>();
  private readonly listeners = new Set<Listener>();

  get(id: string): TrackedStatus | undefined {
    return this.statuses.get(id);
  }

  /** Empieza a seguir un documento. Usa un evento que haya llegado antes, si existe. */
  track(id: string, initial: TrackedStatus = PROCESSING): void {
    if (this.statuses.has(id)) return;
    const buffered = this.early.get(id);
    this.early.delete(id);
    this.statuses.set(id, buffered ?? initial);
    this.emit();
  }

  /**
   * Aplica un estado recibido por evento o por reconciliacion. Un estado final no retrocede.
   * Los documentos no seguidos pasan al buffer acotado.
   */
  apply(id: string, status: DocumentStatus, errorCode: string | null = null): void {
    const current = this.statuses.get(id);
    if (!current) {
      if (status !== 'PROCESANDO') this.remember(id, { status, errorCode });
      return;
    }
    if (current.status !== 'PROCESANDO') return;
    if (current.status === status && current.errorCode === errorCode) return;
    this.statuses.set(id, { status, errorCode });
    this.emit();
  }

  /** Identificadores que siguen en PROCESANDO y deben reconciliarse. */
  pendingIds(): string[] {
    return [...this.statuses].filter(([, value]) => value.status === 'PROCESANDO').map(([id]) => id);
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private remember(id: string, status: TrackedStatus): void {
    this.early.delete(id);
    this.early.set(id, status);
    if (this.early.size > EARLY_EVENTS_LIMIT) {
      const oldest = this.early.keys().next().value;
      if (oldest !== undefined) this.early.delete(oldest);
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
