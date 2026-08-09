import type { SchedulingRepository, VersionedLesson } from '../application/ports.js';
import type { LessonStatus } from '../domain/lesson.js';
import { ConcurrencyError } from '../../shared/domain/errors.js';
import { sqlite } from '../../shared/infrastructure/sqlite.js';

interface LessonRow {
  readonly id: string;
  readonly tutor_id: string;
  readonly status: LessonStatus;
  readonly version: number;
}

export class SqliteSchedulingRepository implements SchedulingRepository {
  public findLesson(id: string): Promise<VersionedLesson | null> {
    const row = sqlite.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as
      LessonRow | undefined;
    return Promise.resolve(
      row ? { id: row.id, tutorId: row.tutor_id, status: row.status, version: row.version } : null,
    );
  }

  public async saveLessonStatus(lesson: VersionedLesson, status: LessonStatus): Promise<void> {
    await Promise.resolve();
    const update = sqlite.transaction(() => {
      const result = sqlite
        .prepare(
          'UPDATE lessons SET status = ?, version = version + 1 WHERE id = ? AND version = ?',
        )
        .run(status, lesson.id, lesson.version);
      if (result.changes !== 1) throw new ConcurrencyError('Lesson', lesson.id);

      if (status !== 'done' || lesson.status === 'done') return;
      const students = this.studentsOfLesson(lesson.id);
      const attendance = sqlite.prepare(
        `INSERT INTO lesson_attendance (lesson_id,student_id,status) VALUES (?,?,'present')
         ON CONFLICT(lesson_id,student_id) DO UPDATE SET status = 'present'`,
      );
      const subscription = sqlite.prepare(
        `UPDATE subscriptions SET lessons_left = lessons_left - 1
         WHERE id = (SELECT id FROM subscriptions WHERE student_id = ? AND lessons_left > 0 LIMIT 1)`,
      );
      for (const studentId of students) {
        attendance.run(lesson.id, studentId);
        subscription.run(studentId);
      }
    });
    update();
  }

  private studentsOfLesson(lessonId: string): string[] {
    interface StudentRow {
      readonly student_id: string;
    }
    return sqlite
      .prepare(
        `SELECT gm.student_id FROM lessons l
         JOIN group_members gm ON gm.group_id = l.group_id AND gm.status = 'active'
         WHERE l.id = ?
         UNION
         SELECT e.student_id FROM lessons l
         JOIN enrollments e ON e.id = l.enrollment_id
         WHERE l.id = ?`,
      )
      .all(lessonId, lessonId)
      .map((item) => (item as StudentRow).student_id);
  }
}
