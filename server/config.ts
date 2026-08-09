import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

if (process.env.NODE_ENV !== 'test') dotenv.config();

const here = __dirname;

const booleanFromEnvironment = z.enum(['true', 'false']).transform((value) => value === 'true');

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_DRIVER: z.enum(['postgres', 'sqlite']).optional(),
  DATABASE_URL: z.url().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
  DATABASE_MIGRATE_ON_START: booleanFromEnvironment.default(true),
  TOKEN_DB: z.string().min(1).optional(),
  COOKIE_SECURE: booleanFromEnvironment.optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),
  SQL_METRICS: booleanFromEnvironment.default(false),
  WRITE_FREEZE: booleanFromEnvironment.default(false),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly databaseDriver: 'postgres' | 'sqlite';
  readonly databaseUrl: string | null;
  readonly databasePoolMax: number;
  readonly databaseStatementTimeoutMs: number;
  readonly databaseMigrateOnStart: boolean;
  readonly databaseFile: string;
  readonly cookieSecure: boolean;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  readonly sqlMetrics: boolean;
  readonly writeFreeze: boolean;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Readonly<AppConfig> {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  }

  const value = parsed.data;
  const databaseDriver =
    value.DATABASE_DRIVER ?? (value.NODE_ENV === 'production' ? 'postgres' : 'sqlite');
  if (databaseDriver === 'postgres' && !value.DATABASE_URL) {
    throw new Error('Invalid environment: DATABASE_URL is required for PostgreSQL');
  }
  return Object.freeze({
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseDriver,
    databaseUrl: value.DATABASE_URL ?? null,
    databasePoolMax: value.DATABASE_POOL_MAX,
    databaseStatementTimeoutMs: value.DATABASE_STATEMENT_TIMEOUT_MS,
    databaseMigrateOnStart: value.DATABASE_MIGRATE_ON_START,
    databaseFile: path.resolve(value.TOKEN_DB ?? path.join(here, '..', 'data', 'token.db')),
    cookieSecure: value.COOKIE_SECURE ?? value.NODE_ENV === 'production',
    logLevel: value.LOG_LEVEL ?? (value.NODE_ENV === 'test' ? 'silent' : 'info'),
    sqlMetrics: value.SQL_METRICS,
    writeFreeze: value.WRITE_FREEZE,
  });
}
