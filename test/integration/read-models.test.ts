import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { v7 as uuidv7 } from 'uuid';

async function up(name: string): Promise<string> {
  const source = await fs.readFile(
    path.join(process.cwd(), 'packages', 'db', 'migrations', name),
    'utf8',
  );
  return source.slice(
    source.indexOf('-- migrate:up') + '-- migrate:up'.length,
    source.indexOf('-- migrate:down'),
  );
}

void test('API v1 read models rebuild synchronously from primary facts', async () => {
  const database = new PGlite();
  try {
    await database.exec(await up('001_initial.sql'));
    await database.exec(await up('002_api_v1_read_models.sql'));
    const subject = uuidv7();
    const user = uuidv7();
    const student = uuidv7();
    const tutorUser = uuidv7();
    const tutor = uuidv7();
    const enrollment = uuidv7();
    const task = uuidv7();
    const assignment = uuidv7();
    const attempt = uuidv7();
    await database.query(
      `INSERT INTO subjects (id,code,name,short_name,slug,color)
       VALUES ($1,'test','Test','T','test','#000000')`,
      [subject],
    );
    await database.query(
      `INSERT INTO users (id,role,name,email,pass_hash,pass_salt)
       VALUES ($1,'student','Student','student@read.test','h','s'),
              ($2,'tutor','Tutor','tutor@read.test','h','s')`,
      [user, tutorUser],
    );
    await database.query('INSERT INTO student_profiles (id,user_id,grade) VALUES ($1,$2,11)', [
      student,
      user,
    ]);
    await database.query('INSERT INTO tutor_profiles (id,user_id) VALUES ($1,$2)', [
      tutor,
      tutorUser,
    ]);
    await database.query(
      `INSERT INTO enrollments (id,student_id,tutor_id,subject_id,status)
       VALUES ($1,$2,$3,$4,'active')`,
      [enrollment, student, tutor, subject],
    );
    await database.query(
      `INSERT INTO tasks (id,subject_id,number,title,statement)
       VALUES ($1,$2,1,'Task','Task')`,
      [task, subject],
    );
    await database.query(
      `INSERT INTO assignments (id,subject_id,enrollment_id,title,due_at,status)
       VALUES ($1,$2,$3,'Assignment',now()+interval '1 day','published')`,
      [assignment, subject, enrollment],
    );
    await database.query(
      'INSERT INTO assignment_tasks (assignment_id,task_id,position) VALUES ($1,$2,0)',
      [assignment, task],
    );
    await database.query(
      `INSERT INTO attempts
       (id,task_id,student_id,subject_id,context,assignment_id,status,is_correct,active_seconds)
       VALUES ($1,$2,$3,$4,'homework',$5,'checked',true,90)`,
      [attempt, task, student, subject, assignment],
    );

    const stats = await database.query<{
      solved_total: number;
      correct_total: number;
      active_seconds: string;
    }>('SELECT solved_total,correct_total,active_seconds::text FROM student_subject_stats');
    assert.deepEqual(stats.rows[0], {
      solved_total: 1,
      correct_total: 1,
      active_seconds: '90',
    });
    const progress = await database.query<{
      status: string;
      completed_tasks: number;
    }>('SELECT status,completed_tasks FROM assignment_progress_view');
    assert.deepEqual(progress.rows[0], { status: 'checked', completed_tasks: 1 });

    await database.query(
      `UPDATE attempts SET status='in_progress',is_correct=NULL,active_seconds=120
       WHERE id=$1`,
      [attempt],
    );
    const refreshed = await database.query<{ solved_total: number; active_seconds: string }>(
      'SELECT solved_total,active_seconds::text FROM student_subject_stats',
    );
    assert.deepEqual(refreshed.rows[0], { solved_total: 0, active_seconds: '120' });
  } finally {
    await database.close();
  }
});
