import { requireOwnership } from '../../shared/domain/ownership-policy.js';

export function requireTutorInvite(tutorId: string | null, actorTutorId: string): void {
  requireOwnership(tutorId, actorTutorId, 'Это не ваше приглашение');
}
