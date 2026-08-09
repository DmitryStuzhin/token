import { requireOwnership } from '../../shared/domain/ownership-policy.js';

export function requireTutorLesson(tutorId: string, actorTutorId: string): void {
  requireOwnership(tutorId, actorTutorId, 'Это не ваше занятие');
}
