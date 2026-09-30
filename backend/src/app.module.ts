import { DynamicModule, Module } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AppConfig } from './config/env';
import { DocumentsModule } from './documents/documents.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SearchModule } from './search/search.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, pool: Pool): DynamicModule {
    return {
      module: AppModule,
      imports: [InfrastructureModule.forRoot(config, pool), DocumentsModule, SearchModule, NotificationsModule],
    };
  }
}
