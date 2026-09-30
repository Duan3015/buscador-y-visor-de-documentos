import type { DocumentDetail } from '@kata/shared';
import { DocumentNotFoundError } from '../../shared-kernel/errors';
import type { DocumentRepository } from '../domain/ports';

/**
 * Detalle de un documento para el visor (HU-03). Un documento en PROCESANDO o ERROR se devuelve
 * con su estado y sin contenido; solo uno inexistente es un 404 (E-23).
 */
export class GetDocument {
  constructor(private readonly repository: DocumentRepository) {}

  async execute(id: string): Promise<DocumentDetail> {
    const detail = await this.repository.findDetailById(id);
    if (!detail) throw new DocumentNotFoundError();
    return detail;
  }
}
