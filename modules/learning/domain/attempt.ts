import { assertTransition, type TransitionMap } from '../../shared/domain/state-machine.js';

export type AttemptStatus =
  'issued' | 'in_progress' | 'submitted' | 'returned' | 'resubmitted' | 'checked';

const transitions: TransitionMap<AttemptStatus> = {
  issued: ['in_progress', 'submitted', 'checked'],
  in_progress: ['submitted', 'checked'],
  submitted: ['returned', 'checked'],
  returned: ['resubmitted'],
  resubmitted: ['returned', 'checked'],
  checked: [],
};

export function transitionAttempt(from: AttemptStatus, to: AttemptStatus): AttemptStatus {
  assertTransition('Attempt', transitions, from, to);
  return to;
}

export function clampActiveSeconds(current: number, supplied: unknown): number {
  const candidate = typeof supplied === 'number' ? supplied : Number(supplied ?? 0);
  const safe = Number.isFinite(candidate) ? candidate : 0;
  return Math.max(current, Math.min(Math.max(0, safe), 6 * 60 * 60));
}
