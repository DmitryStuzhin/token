import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  createSqliteBackup,
  verifySqliteBackup,
} from '../../packages/db/src/sqlite-migration/backup.js';

void test('SQLite cutover backup is restorable and checksum-verified', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'token-backup-'));
  const source = path.join(directory, 'source.db');
  const database = new Database(source);
  database.exec('CREATE TABLE facts (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  database.prepare('INSERT INTO facts (value) VALUES (?)').run('preserved');
  database.close();
  try {
    const backup = await createSqliteBackup(source, path.join(directory, 'backups'));
    await verifySqliteBackup(backup.manifest);
    const restored = new Database(backup.backup, { readonly: true });
    try {
      const row = restored.prepare('SELECT value FROM facts').get() as { value: string };
      assert.equal(row.value, 'preserved');
    } finally {
      restored.close();
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
