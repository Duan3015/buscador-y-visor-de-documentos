import { Module } from '@nestjs/common';
import type { AppConfig } from '../config/env';
import { APP_CONFIG, DATABASE } from '../config/tokens';
import type { Database } from '../database/client';
import { SearchDocuments } from './application/search-documents';
import { SEARCH_REPOSITORY, type SearchRepository } from './domain/ports';
import { PostgresSearchRepository } from './infrastructure/postgres-search-repository';
import { SearchController } from './interface/search.controller';

@Module({
  controllers: [SearchController],
  providers: [
    {
      provide: SEARCH_REPOSITORY,
      inject: [DATABASE, APP_CONFIG],
      useFactory: (database: Database, config: AppConfig) =>
        new PostgresSearchRepository(database, config.maxHighlightChars),
    },
    {
      provide: SearchDocuments,
      inject: [SEARCH_REPOSITORY],
      useFactory: (repository: SearchRepository) => new SearchDocuments(repository),
    },
  ],
})
export class SearchModule {}
