import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { extractSqlite } from '../../packages/db/src/sqlite-migration/extract.js';
import { loadPostgres, readExistingMappings } from '../../packages/db/src/sqlite-migration/load.js';
import { transformDataset } from '../../packages/db/src/sqlite-migration/transform.js';
import { verifyMigration } from '../../packages/db/src/sqlite-migration/verify.js';

void test('two SQLite → PostgreSQL rehearsals are idempotent and verified', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'token-rehearsal-'));
  const source = path.join(directory, 'source.db');
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_DRIVER = 'sqlite';
  process.env.TOKEN_DB = source;
  process.env.LOG_LEVEL = 'silent';
  const require = createRequire(__filename);
  const sqliteModule = require('../../server/db.js') as {
    readonly db: { close(): void };
  };
  sqliteModule.db.close();

  const migration = await fs.readFile(
    path.join(process.cwd(), 'packages', 'db', 'migrations', '001_initial.sql'),
    'utf8',
  );
  const upMarker = '-- migrate:up';
  const downMarker = '-- migrate:down';
  const up = migration.slice(
    migration.indexOf(upMarker) + upMarker.length,
    migration.indexOf(downMarker),
  );
  const database = new PGlite();
  await database.exec(up);

  const client = {
    query: (sql: string, parameters?: readonly unknown[]) =>
      database.query(sql, parameters ? [...parameters] : []),
    release: () => undefined,
  };
  const pool = {
    connect: async () => client,
    query: client.query,
  } as unknown as pg.Pool;

  try {
    const extracted = extractSqlite(source);
    const first = transformDataset(extracted);
    await loadPostgres(pool, first);
    const firstReport = await verifyMigration(pool, first, new Date().toISOString());
    assert.equal(firstReport.success, true, firstReport.countMismatches.join(', '));

    const mappings = await readExistingMappings(pool);
    const second = transformDataset(extracted, mappings);
    const secondLoaded = await loadPostgres(pool, second);
    const secondReport = await verifyMigration(pool, second, new Date().toISOString());
    assert.equal(secondReport.success, true, secondReport.countMismatches.join(', '));
    assert.equal(
      Object.values(secondLoaded).reduce((sum, count) => sum + count, 0),
      0,
    );
    assert.equal(secondReport.checksum, firstReport.checksum);
  } finally {
    await database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
