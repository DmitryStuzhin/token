import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { v7 as uuidv7 } from 'uuid';

void test('PostgreSQL migration creates normalized schema and can roll back', async () => {
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
  const down = migration.slice(migration.indexOf(downMarker) + downMarker.length);
  const database = new PGlite();
  try {
    await database.exec(up);
    const tables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = new Set(tables.rows.map((row) => row.table_name));
    for (const required of [
      'lesson_tasks',
      'assignment_tasks',
      'lesson_links',
      'lesson_notes',
      'attempt_reviews',
      'attempt_history',
      'outbox_events',
      'background_jobs',
      'audit_log',
      'legacy_id_map',
    ]) {
      assert.equal(names.has(required), true, `${required} table is missing`);
    }

    const subjectId = uuidv7();
    await database.query(
      `INSERT INTO subjects (id,code,name,short_name,slug,color)
       VALUES ($1,'explain','Explain','EX','explain','#000000')`,
      [subjectId],
    );
    await database.query(
      `INSERT INTO tasks (id,subject_id,number,title,statement)
       VALUES ($1,$2,1,'Index check','Index check')`,
      [uuidv7(), subjectId],
    );
    await database.exec('SET enable_seqscan = off');
    const explain = await database.query<{ 'QUERY PLAN': unknown }>(
      `EXPLAIN (FORMAT JSON) SELECT id FROM tasks WHERE subject_id=$1 AND number=$2`,
      [subjectId, 1],
    );
    assert.match(JSON.stringify(explain.rows), /tasks_subject_number_idx/);

    await database.exec(down);
    const remaining = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users'`,
    );
    assert.equal(remaining.rows[0]?.count, '0');
  } finally {
    await database.close();
  }
});
