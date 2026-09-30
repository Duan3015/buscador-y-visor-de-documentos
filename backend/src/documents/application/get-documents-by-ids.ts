import type { DocumentStatusList } from '@kata/shared';
import type { DocumentRepository } from '../domain/ports';

/** Estado actual de varios documentos: base de la reconciliacion del cliente (ADR-07). */
export class GetDocumentsByIds {
  constructor(private readonly repository: DocumentRepository) {}

  async execute(ids: string[]): Promise<DocumentStatusList> {
    return { items: await this.repository.findStatusesByIds(ids) };
  }
}
