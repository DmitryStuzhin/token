import type pg from 'pg';

export interface ReadModelVerification {
  readonly rebuiltAt: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly mismatches: Readonly<Record<string, number>>;
  readonly success: boolean;
}

async function count(pool: pg.Pool, sql: string): Promise<number> {
  const result = await pool.query<{ count: string }>(sql);
  return Number(result.rows[0]?.count ?? 0);
}

export async function rebuildAndVerifyReadModels(pool: pg.Pool): Promise<ReadModelVerification> {
  await pool.query('SELECT rebuild_read_models()');

  const counts = {
    studentDashboard: await count(pool, 'SELECT count(*)::text count FROM student_dashboard_view'),
    tutorToday: await count(pool, 'SELECT count(*)::text count FROM tutor_today_view'),
    assignmentProgress: await count(
      pool,
      'SELECT count(*)::text count FROM assignment_progress_view',
    ),
    studentSubjectStats: await count(
      pool,
      'SELECT count(*)::text count FROM student_subject_stats',
    ),
  };

  const mismatches = {
    dashboardWithoutStats: await count(
      pool,
      `SELECT count(*)::text count FROM student_dashboard_view d
       LEFT JOIN student_subject_stats s USING (student_id, subject_id)
       WHERE s.student_id IS NULL`,
    ),
    statsWithoutDashboard: await count(
      pool,
      `SELECT count(*)::text count FROM student_subject_stats s
       LEFT JOIN student_dashboard_view d USING (student_id, subject_id)
       WHERE d.student_id IS NULL`,
    ),
    assignmentTotals: await count(
      pool,
      `SELECT count(*)::text count FROM assignment_progress_view p
       WHERE p.completed_tasks > p.total_tasks OR p.correct_tasks > p.completed_tasks`,
    ),
    negativeAggregates: await count(
      pool,
      `SELECT count(*)::text count FROM student_subject_stats
       WHERE solved_total < 0 OR checked_total < 0 OR correct_total < 0 OR active_seconds < 0`,
    ),
  };
  return {
    rebuiltAt: new Date().toISOString(),
    counts,
    mismatches,
    success: Object.values(mismatches).every((value) => value === 0),
  };
}
