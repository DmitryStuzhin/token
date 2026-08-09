import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { TransformedDataset, VerificationReport } from './types.js';

const SAME_NAME_TABLES = [
  'subjects',
  'topics',
  'tasks',
  'users',
  'sessions',
  'student_profiles',
  'tutor_profiles',
  'invites',
  'enrollments',
  'groups',
  'group_members',
  'lessons',
  'lesson_attendance',
  'assignments',
  'attempts',
  'goals',
  'subscriptions',
  'notification_prefs',
  'mock_exams',
] as const;

export async function verifyMigration(
  pool: pg.Pool,
  dataset: TransformedDataset,
  startedAt: string,
): Promise<VerificationReport> {
  const targetCounts: Record<string, number> = {};
  for (const table of SAME_NAME_TABLES) {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table}`,
    );
    targetCounts[table] = Number(result.rows[0]?.count ?? 0);
  }
  const countMismatches = SAME_NAME_TABLES.flatMap((table) => {
    const source = dataset.sourceCounts[table] ?? 0;
    const target = targetCounts[table] ?? 0;
    return source === target
      ? []
      : [`${table}: source=${String(source)}, target=${String(target)}`];
  });

  const orphanQueries: Readonly<Record<string, string>> = {
    student_profile_users: `SELECT count(*)::text count FROM student_profiles p LEFT JOIN users u ON u.id=p.user_id WHERE u.id IS NULL`,
    tutor_profile_users: `SELECT count(*)::text count FROM tutor_profiles p LEFT JOIN users u ON u.id=p.user_id WHERE u.id IS NULL`,
    enrollment_students: `SELECT count(*)::text count FROM enrollments e LEFT JOIN student_profiles s ON s.id=e.student_id WHERE s.id IS NULL`,
    lesson_targets: `SELECT count(*)::text count FROM lessons WHERE (enrollment_id IS NULL) = (group_id IS NULL)`,
    assignment_targets: `SELECT count(*)::text count FROM assignments WHERE (enrollment_id IS NULL) = (group_id IS NULL)`,
    attempt_tasks: `SELECT count(*)::text count FROM attempts a LEFT JOIN tasks t ON t.id=a.task_id WHERE t.id IS NULL`,
    attempt_students: `SELECT count(*)::text count FROM attempts a LEFT JOIN student_profiles s ON s.id=a.student_id WHERE s.id IS NULL`,
  };
  const orphanCounts: Record<string, number> = {};
  for (const [name, query] of Object.entries(orphanQueries)) {
    const result = await pool.query<{ count: string }>(query);
    orphanCounts[name] = Number(result.rows[0]?.count ?? 0);
  }

  const aggregateResult = await pool.query<{
    students: string;
    attempts: string;
    active_seconds: string;
    tries: string;
    checked: string;
  }>(`SELECT count(DISTINCT student_id)::text students, count(*)::text attempts,
      COALESCE(sum(active_seconds),0)::text active_seconds,
      COALESCE(sum(tries),0)::text tries,
      count(*) FILTER (WHERE status='checked')::text checked FROM attempts`);
  const aggregate = aggregateResult.rows[0];
  const aggregateChecks = {
    studentsWithAttempts: Number(aggregate?.students ?? 0),
    attempts: Number(aggregate?.attempts ?? 0),
    activeSeconds: Number(aggregate?.active_seconds ?? 0),
    tries: Number(aggregate?.tries ?? 0),
    checked: Number(aggregate?.checked ?? 0),
  };

  const mappings = await pool.query<{ value: string }>(
    `SELECT source_table || ':' || legacy_id || ':' || target_id::text AS value
     FROM legacy_id_map ORDER BY source_table, legacy_id`,
  );
  const checksum = createHash('sha256')
    .update(mappings.rows.map((row) => row.value).join('\n'))
    .update(JSON.stringify(targetCounts))
    .digest('hex');
  const orphanTotal = Object.values(orphanCounts).reduce((sum, value) => sum + value, 0);
  return {
    runId: randomUUID(),
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceFile: dataset.sourceFile,
    success: countMismatches.length === 0 && orphanTotal === 0,
    sourceCounts: dataset.sourceCounts,
    targetCounts,
    countMismatches,
    orphanCounts,
    aggregateChecks,
    checksum,
    warnings: dataset.warnings,
  };
}
