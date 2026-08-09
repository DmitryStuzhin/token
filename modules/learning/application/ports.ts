import type { AssignmentStatus } from '../domain/assignment.js';
import type { AttemptStatus } from '../domain/attempt.js';

export interface VersionedAssignment {
  readonly id: string;
  readonly status: AssignmentStatus;
  readonly version: number;
}

export interface VersionedAttempt {
  readonly id: string;
  readonly studentId: string;
  readonly status: AttemptStatus;
  readonly version: number;
}

export interface LearningRepository {
  findAssignment(id: string): Promise<VersionedAssignment | null>;
  saveAssignmentStatus(assignment: VersionedAssignment, status: AssignmentStatus): Promise<void>;
  findAttempt(id: string): Promise<VersionedAttempt | null>;
  saveAttemptStatus(attempt: VersionedAttempt, status: AttemptStatus): Promise<void>;
}
