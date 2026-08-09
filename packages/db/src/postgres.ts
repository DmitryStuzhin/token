import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DatabaseSchema } from './schema.js';

export interface PostgresOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly statementTimeoutMs?: number;
}

export function createPostgresPool(options: PostgresOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    statement_timeout: options.statementTimeoutMs ?? 10_000,
    application_name: 'token-api',
  });
  pool.on('error', (error) => {
    process.stderr.write(
      `${JSON.stringify({ level: 'error', event: 'postgres_pool_error', error: error.message })}\n`,
    );
  });
  return pool;
}

export function createPostgresDatabase(pool: pg.Pool): Kysely<DatabaseSchema> {
  return new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
}
