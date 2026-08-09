import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionInvite } from '../../modules/relationships/domain/invite.js';
import { transitionLesson } from '../../modules/scheduling/domain/lesson.js';
import { transitionAssignment } from '../../modules/learning/domain/assignment.js';
import { transitionAttempt } from '../../modules/learning/domain/attempt.js';
import { DomainError } from '../../modules/shared/domain/errors.js';
import { domainEvent } from '../../modules/shared/application/event-factory.js';
import { InProcessEventDispatcher } from '../../modules/shared/infrastructure/in-process-dispatcher.js';

void test('разрешённые переходы агрегатов выполняются', () => {
  assert.equal(transitionInvite('active', 'used_up'), 'used_up');
  assert.equal(transitionLesson('planned', 'done'), 'done');
  assert.equal(transitionAssignment('draft', 'published'), 'published');
  assert.equal(transitionAttempt('returned', 'resubmitted'), 'resubmitted');
  assert.equal(transitionAttempt('resubmitted', 'checked'), 'checked');
});

void test('терминальные состояния нельзя открыть повторно', () => {
  assert.throws(() => transitionInvite('revoked', 'active'), DomainError);
  assert.throws(() => transitionLesson('done', 'planned'), DomainError);
  assert.throws(() => transitionAssignment('archived', 'published'), DomainError);
  assert.throws(() => transitionAttempt('checked', 'in_progress'), DomainError);
});

void test('in-process dispatcher доставляет версионированный envelope подписчику', async () => {
  const dispatcher = new InProcessEventDispatcher();
  const received: string[] = [];
  dispatcher.subscribe('AttemptChecked', (event) => {
    received.push(`${String(event.eventVersion)}:${event.aggregateId}`);
  });

  await dispatcher.publish(
    domainEvent({
      name: 'AttemptChecked',
      aggregateId: 'attempt-1',
      correlationId: 'request-1',
      payload: { attemptId: 'attempt-1', studentId: 'student-1', automatic: true },
    }),
  );

  assert.deepEqual(received, ['1:attempt-1']);
});
