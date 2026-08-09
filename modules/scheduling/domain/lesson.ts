import { assertTransition, type TransitionMap } from '../../shared/domain/state-machine.js';

export type LessonStatus = 'planned' | 'done' | 'moved' | 'cancelled' | 'missed';

const transitions: TransitionMap<LessonStatus> = {
  planned: ['done', 'moved', 'cancelled', 'missed'],
  moved: ['planned', 'cancelled'],
  done: [],
  cancelled: [],
  missed: [],
};

export function transitionLesson(from: LessonStatus, to: LessonStatus): LessonStatus {
  assertTransition('Lesson', transitions, from, to);
  return to;
}
