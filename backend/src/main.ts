import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { ConfigError, loadConfig, maskDatabaseUrl } from './config/env';
import { loadEnvFileIfPresent } from './config/load-env-file';
import { StartupError } from './database/schema-check';

async function main(): Promise<void> {
  const logger = new Logger('Bootstrap');

  try {
    loadEnvFileIfPresent();
    const config = loadConfig(process.env);
    const app = await createApp(config);
    const database = maskDatabaseUrl(config.databaseUrl);
    if (config.appRole === 'worker') {
      // El rol worker solo consume la cola: no abre un puerto HTTP.
      await app.init();
      logger.log(`Worker en marcha (base de datos ${database})`);
      return;
    }
    await app.listen(config.port);
    logger.log(`API escuchando en el puerto ${config.port} (rol ${config.appRole}, base de datos ${database})`);
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error(error.message);
      error.messages.forEach((message) => logger.error(`  - ${message}`));
    } else if (error instanceof StartupError) {
      logger.error(error.message);
    } else {
      logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
    process.exit(1);
  }
}

void main();
