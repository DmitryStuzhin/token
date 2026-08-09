import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(__filename);
const { ensureReferenceData } = require('../../server/reference-data.js') as {
  ensureReferenceData(pool: unknown): Promise<void>;
};

void test('PostgreSQL reference data is idempotent and repairs subjectless tutors', async () => {
  const database = new PGlite();
  const migration = await fs.readFile(
    path.join(process.cwd(), 'packages', 'db', 'migrations', '001_initial.sql'),
    'utf8',
  );
  await database.exec(
    migration.slice(
      migration.indexOf('-- migrate:up') + '-- migrate:up'.length,
      migration.indexOf('-- migrate:down'),
    ),
  );
  const query = async (sql: string, parameters?: readonly unknown[]) =>
    database.query(sql, parameters ? [...parameters] : []);
  const client = { query, release: () => undefined };
  const pool = { query, connect: async () => client };

  try {
    await query(
      `INSERT INTO users (id,role,name,email,pass_hash,pass_salt)
       VALUES ('00000000-0000-0000-0000-000000000001','tutor','Tutor','tutor@example.test','x','x')`,
    );
    await query(
      `INSERT INTO tutor_profiles (id,user_id)
       VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001')`,
    );

    await ensureReferenceData(pool);
    await ensureReferenceData(pool);

    const subjects = (await query('SELECT code FROM subjects ORDER BY code')).rows as Array<{
      code: string;
    }>;
    assert.deepEqual(
      subjects.map((row) => row.code),
      ['inf', 'math'],
    );
    const topics = (await query('SELECT count(*)::integer count FROM topics')).rows as Array<{
      count: number;
    }>;
    assert.equal(topics.at(0)?.count, 16);
    const tutorSubjects = (
      await query(
        `SELECT s.code FROM tutor_subjects ts JOIN subjects s ON s.id=ts.subject_id
       ORDER BY s.code`,
      )
    ).rows as Array<{ code: string }>;
    assert.deepEqual(
      tutorSubjects.map((row) => row.code),
      ['inf', 'math'],
    );
  } finally {
    await database.close();
  }
});
