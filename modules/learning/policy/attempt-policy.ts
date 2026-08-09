import { requireStudentOwnership } from '../../shared/domain/ownership-policy.js';

export function requireOwnAttempt(studentId: string, actorStudentId: string): void {
  requireStudentOwnership(studentId, actorStudentId);
}
