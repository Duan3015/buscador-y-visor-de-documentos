import type { DocumentAccepted, DocumentStatus, UploadMetadata } from '@kata/shared';
import { ApiError } from '../../shared/api/client';
import { describeApiError } from '../../shared/lib/error-messages';

/** Envios simultaneos maximos (ADR-12): cada uno transmite hasta 20 MB y la API los guarda en disco. */
export const MAX_CONCURRENT_UPLOADS = 3;

export type UploadState = 'EN_COLA' | 'ENVIANDO' | 'ACEPTADO' | 'RECHAZADO';

export interface UploadRequest {
  file: File;
  metadata: UploadMetadata;
}

export interface UploadItem {
  key: number;
  file: File;
  metadata: UploadMetadata;
  state: UploadState;
  /** Identificador asignado por el servidor tras el 202. */
  documentId?: string;
  /** Codigo y mensaje del rechazo (solo en RECHAZADO). */
  errorCode?: string;
  message?: string;
  /** Documento existente cuando el rechazo es un 409 por contenido duplicado. */
  existing?: { id: string; status: DocumentStatus };
}

export type SendUpload = (request: UploadRequest) => Promise<DocumentAccepted>;

type Listener = () => void;

/**
 * Cola de envios con concurrencia limitada (E-07, E-45). Cada archivo es una solicitud
 * independiente con su propio resultado; un fallo no detiene a los demas. Es un almacen externo
 * compatible con useSyncExternalStore: cada cambio publica un arreglo nuevo.
 */
export class UploadQueue {
  private items: readonly UploadItem[] = [];
  private nextKey = 1;
  private running = 0;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly send: SendUpload,
    private readonly onAccepted: (documentId: string) => void = () => undefined,
    private readonly concurrency: number = MAX_CONCURRENT_UPLOADS,
  ) {}

  getSnapshot = (): readonly UploadItem[] => this.items;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** True mientras haya archivos por enviar o enviandose. */
  isBusy(): boolean {
    return this.items.some((item) => item.state === 'EN_COLA' || item.state === 'ENVIANDO');
  }

  enqueue(requests: UploadRequest[]): void {
    if (requests.length === 0) return;
    const added = requests.map<UploadItem>((request) => ({ ...request, key: this.nextKey++, state: 'EN_COLA' }));
    this.items = [...this.items, ...added];
    this.emit();
    this.pump();
  }

  /** Quita de la lista los envios ya resueltos (los que estan en curso se conservan). */
  clearFinished(): void {
    this.items = this.items.filter((item) => item.state === 'EN_COLA' || item.state === 'ENVIANDO');
    this.emit();
  }

  private pump(): void {
    while (this.running < this.concurrency) {
      const next = this.items.find((item) => item.state === 'EN_COLA');
      if (!next) return;
      this.running += 1;
      this.update(next.key, { state: 'ENVIANDO' });
      void this.run(next);
    }
  }

  private async run(item: UploadItem): Promise<void> {
    try {
      const accepted = await this.send({ file: item.file, metadata: item.metadata });
      // Se sigue el documento antes de publicar el estado: si el evento de indexado llega ahora, no se pierde.
      try {
        this.onAccepted(accepted.id);
      } catch {
        // Un fallo del seguimiento no debe convertir en rechazo un documento que el servidor ya acepto.
      }
      this.update(item.key, { state: 'ACEPTADO', documentId: accepted.id });
    } catch (error) {
      this.update(item.key, {
        state: 'RECHAZADO',
        errorCode: error instanceof ApiError ? error.code : 'UNKNOWN_ERROR',
        message: describeApiError(error),
        existing: error instanceof ApiError ? error.problem?.existing : undefined,
      });
    } finally {
      this.running -= 1;
      this.pump();
    }
  }

  private update(key: number, patch: Partial<UploadItem>): void {
    this.items = this.items.map((item) => (item.key === key ? { ...item, ...patch } : item));
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
