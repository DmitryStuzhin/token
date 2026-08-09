import type {
  LearningRepository,
  VersionedAssignment,
  VersionedAttempt,
} from '../application/ports.js';
import type { AssignmentStatus } from '../domain/assignment.js';
import type { AttemptStatus } from '../domain/attempt.js';
import { ConcurrencyError } from '../../shared/domain/errors.js';
import { sqlite } from '../../shared/infrastructure/sqlite.js';

interface AssignmentRow {
  readonly id: string;
  readonly status: AssignmentStatus;
  readonly version: number;
}

interface AttemptRow {
  readonly id: string;
  readonly student_id: string;
  readonly status: AttemptStatus;
  readonly version: number;
}

export class SqliteLearningRepository implements LearningRepository {
  public findAssignment(id: string): Promise<VersionedAssignment | null> {
    const row = sqlite.prepare('SELECT * FROM assignments WHERE id = ?').get(id) as
      AssignmentRow | undefined;
    return Promise.resolve(row ? { id: row.id, status: row.status, version: row.version } : null);
  }

  public async saveAssignmentStatus(
    assignment: VersionedAssignment,
    status: AssignmentStatus,
  ): Promise<void> {
    await Promise.resolve();
    const result = sqlite
      .prepare(
        'UPDATE assignments SET status = ?, version = version + 1 WHERE id = ? AND version = ?',
      )
      .run(status, assignment.id, assignment.version);
    if (result.changes !== 1) throw new ConcurrencyError('Assignment', assignment.id);
  }

  public findAttempt(id: string): Promise<VersionedAttempt | null> {
    const row = sqlite.prepare('SELECT * FROM attempts WHERE id = ?').get(id) as
      AttemptRow | undefined;
    return Promise.resolve(
      row
        ? { id: row.id, studentId: row.student_id, status: row.status, version: row.version }
        : null,
    );
  }

  public async saveAttemptStatus(attempt: VersionedAttempt, status: AttemptStatus): Promise<void> {
    await Promise.resolve();
    const result = sqlite
      .prepare('UPDATE attempts SET status = ?, version = version + 1 WHERE id = ? AND version = ?')
      .run(status, attempt.id, attempt.version);
    if (result.changes !== 1) throw new ConcurrencyError('Attempt', attempt.id);
  }
}
