import { DomainError } from './errors.js';

export function requireOwnership(
  actualOwnerId: string | null | undefined,
  actorOwnerId: string,
  message: string,
): void {
  if (!actualOwnerId || actualOwnerId !== actorOwnerId) {
    throw new DomainError('FORBIDDEN', message);
  }
}

export function requireStudentOwnership(
  actualStudentId: string,
  actorStudentId: string,
): void {
  requireOwnership(actualStudentId, actorStudentId, 'Это чужая работа');
}
