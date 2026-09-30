import type { DocumentFormat } from '@kata/shared';
import type { ExtractionLimits } from '../../domain/ports';

/** Estrategia de extraccion para uno o mas formatos (ADR-09). */
export interface FormatExtractor {
  readonly formats: readonly DocumentFormat[];
  extract(data: Buffer, limits: ExtractionLimits): Promise<string>;
}
