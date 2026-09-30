import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://docs:docs@localhost:5433/docs_test';
process.env.STORAGE_DIR = path.join(os.tmpdir(), `kata-storage-${process.pid}`);
process.env.APP_ROLE = 'all';
process.env.LOG_LEVEL = 'error';
