import { searchQuerySchema, toFieldErrors, type SearchResponse } from '@kata/shared';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { InvalidQueryError } from '../../shared-kernel/errors';
import { SearchDocuments } from '../application/search-documents';

@Controller('search')
export class SearchController {
  constructor(@Inject(SearchDocuments) private readonly searchDocuments: SearchDocuments) {}

  @Get()
  async search(@Query() rawQuery: Record<string, unknown>): Promise<SearchResponse> {
    const parsed = searchQuerySchema.safeParse({ ...rawQuery });
    if (!parsed.success) throw new InvalidQueryError(toFieldErrors(parsed.error));
    return this.searchDocuments.execute(parsed.data);
  }
}
