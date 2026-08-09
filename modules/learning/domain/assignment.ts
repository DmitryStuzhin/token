import { assertTransition, type TransitionMap } from '../../shared/domain/state-machine.js';

export type AssignmentStatus = 'draft' | 'published' | 'closed' | 'archived';

const transitions: TransitionMap<AssignmentStatus> = {
  draft: ['published', 'archived'],
  published: ['closed', 'archived'],
  closed: ['archived'],
  archived: [],
};

export function transitionAssignment(
  from: AssignmentStatus,
  to: AssignmentStatus,
): AssignmentStatus {
  assertTransition('Assignment', transitions, from, to);
  return to;
}
