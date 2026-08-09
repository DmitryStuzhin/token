export interface DomainEventEnvelope<Name extends string, Payload> {
  readonly eventId: string;
  readonly eventName: Name;
  readonly eventVersion: 1;
  readonly occurredAt: string;
  readonly aggregateId: string;
  readonly correlationId: string | null;
  readonly payload: Readonly<Payload>;
}

export type UserRegistered = DomainEventEnvelope<
  'UserRegistered',
  { readonly userId: string; readonly role: 'student' | 'tutor' }
>;
export type InviteAccepted = DomainEventEnvelope<
  'InviteAccepted',
  { readonly inviteId: string; readonly studentId: string }
>;
export type LessonCompleted = DomainEventEnvelope<
  'LessonCompleted',
  { readonly lessonId: string; readonly tutorId: string }
>;
export type AssignmentPublished = DomainEventEnvelope<
  'AssignmentPublished',
  { readonly assignmentId: string; readonly tutorId: string }
>;
export type AttemptChecked = DomainEventEnvelope<
  'AttemptChecked',
  { readonly attemptId: string; readonly studentId: string; readonly automatic: boolean }
>;

export type PlatformEvent =
  | UserRegistered
  | InviteAccepted
  | LessonCompleted
  | AssignmentPublished
  | AttemptChecked;

export type EventName = PlatformEvent['eventName'];
export type EventHandler = (event: PlatformEvent) => void | Promise<void>;

export interface EventPublisher {
  publish(event: PlatformEvent): Promise<void>;
}
