import type { DocumentRepository, ErrorDocumentSummary, FileStorage, PurgeFilter } from '../domain/ports';
import { NOOP_WORK_LOGGER, type WorkLogger } from './document-failure';

export interface PurgeCommand {
  filter: PurgeFilter;
  /** Sin confirmacion solo se informa lo que se eliminaria (simulacro). */
  confirm: boolean;
}

export interface PurgeReport {
  /** Documentos en ERROR que cumplen el filtro. */
  candidates: ErrorDocumentSummary[];
  deleted: number;
  /** Documentos que dejaron de estar en ERROR entre el listado y el borrado (no se tocan). */
  skipped: number;
  /** Documentos cuyo borrado fallo por un error de infraestructura. */
  failed: number;
  /** Registros eliminados cuyo archivo no se pudo borrar (quedan huerfanos en el disco). */
  orphanFiles: string[];
}

/**
 * Procedimiento operativo de ADR-06: elimina los documentos en ERROR para poder volver a subir el
 * mismo archivo. Es un simulacro salvo confirmacion explicita. Primero se borra el registro (con la
 * condicion ERROR en la misma sentencia) y despues el archivo: si el segundo paso falla queda un
 * archivo huerfano, que es preferible a un registro sin archivo. Un fallo en un documento no
 * detiene el resto.
 */
export class PurgeErrorDocuments {
  constructor(
    private readonly repository: DocumentRepository,
    private readonly storage: FileStorage,
    private readonly logger: WorkLogger = NOOP_WORK_LOGGER,
  ) {}

  async execute(command: PurgeCommand): Promise<PurgeReport> {
    const candidates = await this.repository.listErrorDocuments(command.filter);
    const report: PurgeReport = { candidates, deleted: 0, skipped: 0, failed: 0, orphanFiles: [] };
    if (!command.confirm) return report;

    for (const candidate of candidates) {
      try {
        const removed = await this.repository.deleteErrorDocument(candidate.id);
        if (!removed) {
          report.skipped += 1;
          this.logger.warn(`documentId=${candidate.id} ya no esta en ERROR; se omite`);
          continue;
        }
        report.deleted += 1;
      } catch (error) {
        report.failed += 1;
        this.logger.error(`documentId=${candidate.id} no se pudo eliminar: ${describe(error)}`);
        continue;
      }

      try {
        await this.storage.remove(candidate.id);
      } catch (error) {
        report.orphanFiles.push(candidate.id);
        this.logger.warn(`documentId=${candidate.id} eliminado, pero su archivo quedo huerfano: ${describe(error)}`);
      }
    }
    return report;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
