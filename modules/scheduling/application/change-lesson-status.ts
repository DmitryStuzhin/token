import type { EventPublisher } from '../../shared/application/events.js';
import { domainEvent } from '../../shared/application/event-factory.js';
import { DomainError } from '../../shared/domain/errors.js';
import { requireOwnership } from '../../shared/domain/ownership-policy.js';
import { transitionLesson, type LessonStatus } from '../domain/lesson.js';
import type { SchedulingRepository } from './ports.js';

export class ChangeLessonStatus {
  public constructor(
    private readonly repository: SchedulingRepository,
    private readonly events: EventPublisher,
  ) {}

  public async execute(input: {
    readonly lessonId: string;
    readonly tutorId: string;
    readonly status: LessonStatus;
    readonly correlationId?: string;
  }): Promise<void> {
    const lesson = await this.repository.findLesson(input.lessonId);
    if (!lesson) throw new DomainError('FORBIDDEN', 'Это не ваше занятие');
    requireOwnership(lesson.tutorId, input.tutorId, 'Это не ваше занятие');
    const status = transitionLesson(lesson.status, input.status);
    await this.repository.saveLessonStatus(lesson, status);

    if (status === 'done' && lesson.status !== 'done') {
      await this.events.publish(
        domainEvent({
          name: 'LessonCompleted',
          aggregateId: lesson.id,
          ...(input.correlationId ? { correlationId: input.correlationId } : {}),
          payload: { lessonId: lesson.id, tutorId: input.tutorId },
        }),
      );
    }
  }
}
