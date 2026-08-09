import type pg from 'pg';
import type { SchedulingRepository, VersionedLesson } from '../application/ports.js';
import type { LessonStatus } from '../domain/lesson.js';
import { ConcurrencyError } from '../../shared/domain/errors.js';

interface LessonRow {
  readonly id: string;
  readonly tutor_id: string;
  readonly status: LessonStatus;
  readonly version: number;
}

export class PostgresSchedulingRepository implements SchedulingRepository {
  public constructor(private readonly pool: pg.Pool) {}

  public async findLesson(id: string): Promise<VersionedLesson | null> {
    const result = await this.pool.query<LessonRow>(
      `SELECT l.id::text, COALESCE(tp.legacy_id,tp.id::text) tutor_id, l.status, l.version
       FROM lessons l JOIN tutor_profiles tp ON tp.id=l.tutor_id
       WHERE l.id::text=$1 OR l.legacy_id=$1 LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    return row
      ? { id: row.id, tutorId: row.tutor_id, status: row.status, version: row.version }
      : null;
  }

  public async saveLessonStatus(lesson: VersionedLesson, status: LessonStatus): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE lessons SET status=$1, version=version+1, updated_at=now()
         WHERE id=$2::uuid AND version=$3`,
        [status, lesson.id, lesson.version],
      );
      if (updated.rowCount !== 1) throw new ConcurrencyError('Lesson', lesson.id);
      if (status === 'done' && lesson.status !== 'done') {
        await client.query(
          `INSERT INTO lesson_attendance (lesson_id, student_id, status)
           SELECT l.id, gm.student_id, 'present' FROM lessons l
           JOIN group_members gm ON gm.group_id=l.group_id AND gm.status='active'
           WHERE l.id=$1::uuid
           UNION ALL
           SELECT l.id, e.student_id, 'present' FROM lessons l
           JOIN enrollments e ON e.id=l.enrollment_id WHERE l.id=$1::uuid
           ON CONFLICT (lesson_id,student_id) DO UPDATE
           SET status='present', updated_at=now(), version=lesson_attendance.version+1`,
          [lesson.id],
        );
        await client.query(
          `UPDATE subscriptions s SET lessons_left=lessons_left-1, updated_at=now(), version=version+1
           WHERE lessons_left>0 AND student_id IN (
             SELECT gm.student_id FROM lessons l JOIN group_members gm ON gm.group_id=l.group_id AND gm.status='active' WHERE l.id=$1::uuid
             UNION SELECT e.student_id FROM lessons l JOIN enrollments e ON e.id=l.enrollment_id WHERE l.id=$1::uuid
           ) AND s.id IN (SELECT DISTINCT ON (student_id) id FROM subscriptions WHERE status='active' ORDER BY student_id, created_at DESC)`,
          [lesson.id],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
