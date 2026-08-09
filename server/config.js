import path from 'node:path';
import { existsSync } from 'node:fs';

if (existsSync('.env') && process.loadEnvFile) process.loadEnvFile('.env');

export const config = {
  port: Number(process.env.PORT || 8000),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://arcs:arcs@127.0.0.1:5432/arcs',
  storageDir: path.resolve(process.env.STORAGE_DIR || './var/storage'),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:8000',
  kompegeApiBase: process.env.KOMPEGE_API_BASE || 'https://kompege.ru/api/v1',
  kompegeSiteBase: process.env.KOMPEGE_SITE_BASE || 'https://kompege.ru',
  importDelayMs: Number(process.env.IMPORT_REQUEST_DELAY_MS || 800),
  maxFileBytes: Number(process.env.IMPORT_MAX_FILE_BYTES || 25 * 1024 * 1024),
};
