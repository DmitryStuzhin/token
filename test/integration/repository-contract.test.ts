import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import type { RelationshipRepository } from '../../modules/relationships/application/ports.js';
import { PostgresRelationshipRepository } from '../../modules/relationships/infrastructure/postgres-relationship-repository.js';
import { ConcurrencyError } from '../../modules/shared/domain/errors.js';

async function assertRelationshipContract(
  repository: RelationshipRepository,
  id: string,
): Promise<void> {
  const invite = await repository.findInvite(id);
  assert.ok(invite);
  assert.equal(invite.status, 'active');
  assert.equal(invite.version, 1);
  await repository.saveInviteStatus(invite, 'revoked');
  const updated = await repository.findInvite(id);
  assert.equal(updated?.status, 'revoked');
  assert.equal(updated?.version, 2);
  await assert.rejects(repository.saveInviteStatus(invite, 'expired'), ConcurrencyError);
}

void test('RelationshipRepository contract is identical for SQLite and PostgreSQL', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'token-contract-'));
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_DRIVER = 'sqlite';
  process.env.TOKEN_DB = path.join(directory, 'contract.db');
  process.env.LOG_LEVEL = 'silent';
  const require = createRequire(__filename);
  const { db } = require('../../server/db.js') as {
    readonly db: {
      prepare(sql: string): { run(...parameters: unknown[]): unknown };
      close(): void;
    };
  };
  const { SqliteRelationshipRepository } =
    require('../../modules/relationships/infrastructure/sqlite-relationship-repository.ts') as typeof import('../../modules/relationships/infrastructure/sqlite-relationship-repository.js');
  const sqliteId = uuidv7();
  db.prepare(
    `INSERT INTO invites
    (id,code,kind,used_count,status,version) VALUES (?,?,'enrollment',0,'active',1)`,
  ).run(sqliteId, 'SQLITE-1');
  await assertRelationshipContract(new SqliteRelationshipRepository(), sqliteId);
  db.close();

  const database = new PGlite();
  try {
    const migration = await fs.readFile(
      path.join(process.cwd(), 'packages', 'db', 'migrations', '001_initial.sql'),
      'utf8',
    );
    const up = migration.slice(
      migration.indexOf('-- migrate:up') + '-- migrate:up'.length,
      migration.indexOf('-- migrate:down'),
    );
    await database.exec(up);
    const postgresId = uuidv7();
    await database.query(
      `INSERT INTO invites (id,code,kind,used_count,status,version)
       VALUES ($1,$2,'enrollment',0,'active',1)`,
      [postgresId, 'POSTGRES-1'],
    );
    const pool = {
      query: async (sql: string, parameters?: readonly unknown[]) => {
        const result = await database.query(sql, parameters ? [...parameters] : []);
        return {
          ...result,
          rowCount:
            result.affectedRows ??
            (sql.trimStart().toUpperCase().startsWith('SELECT') ? result.rows.length : 0),
        };
      },
    } as unknown as pg.Pool;
    await assertRelationshipContract(new PostgresRelationshipRepository(pool), postgresId);
  } finally {
    await database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
