import type pg from 'pg';
import type { Kysely } from 'kysely';
import { createPostgresDatabase } from '../../../packages/db/src/postgres.js';
import type { DatabaseSchema } from '../../../packages/db/src/schema.js';
import type {
  LearningRepository,
  VersionedAssignment,
  VersionedAttempt,
} from '../application/ports.js';
import type { AssignmentStatus } from '../domain/assignment.js';
import type { AttemptStatus } from '../domain/attempt.js';
import { ConcurrencyError } from '../../shared/domain/errors.js';

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

export class PostgresLearningRepository implements LearningRepository {
  readonly #database: Kysely<DatabaseSchema>;

  public constructor(private readonly pool: pg.Pool) {
    this.#database = createPostgresDatabase(pool);
  }

  public async findAssignment(id: string): Promise<VersionedAssignment | null> {
    const row = (await this.#database
      .selectFrom('assignments')
      .select(['id', 'status', 'version'])
      .where((expression) =>
        expression.or([expression('id', '=', id), expression('legacy_id', '=', id)]),
      )
      .executeTakeFirst()) as AssignmentRow | undefined;
    return row ? { id: row.id, status: row.status, version: row.version } : null;
  }

  public async saveAssignmentStatus(
    assignment: VersionedAssignment,
    status: AssignmentStatus,
  ): Promise<void> {
    const result = await this.#database
      .updateTable('assignments')
      .set((expression) => ({
        status,
        version: expression('version', '+', 1),
        updated_at: new Date(),
      }))
      .where('id', '=', assignment.id)
      .where('version', '=', assignment.version)
      .executeTakeFirst();
    if (result.numUpdatedRows !== 1n) throw new ConcurrencyError('Assignment', assignment.id);
  }

  public async findAttempt(id: string): Promise<VersionedAttempt | null> {
    const result = await this.pool.query<AttemptRow>(
      `SELECT a.id::text, COALESCE(sp.legacy_id,sp.id::text) student_id, a.status, a.version
       FROM attempts a JOIN student_profiles sp ON sp.id=a.student_id
       WHERE a.id::text=$1 OR a.legacy_id=$1 LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    return row
      ? { id: row.id, studentId: row.student_id, status: row.status, version: row.version }
      : null;
  }

  public async saveAttemptStatus(attempt: VersionedAttempt, status: AttemptStatus): Promise<void> {
    const result = await this.pool.query(
      `UPDATE attempts SET status=$1, version=version+1, updated_at=now()
       WHERE id=$2::uuid AND version=$3`,
      [status, attempt.id, attempt.version],
    );
    if (result.rowCount !== 1) throw new ConcurrencyError('Attempt', attempt.id);
  }
}
