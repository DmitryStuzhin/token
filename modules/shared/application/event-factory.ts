import { randomUUID } from 'node:crypto';
import type { DomainEventEnvelope } from './events.js';

export function domainEvent<Name extends string, Payload>(input: {
  readonly name: Name;
  readonly aggregateId: string;
  readonly correlationId?: string;
  readonly payload: Readonly<Payload>;
}): DomainEventEnvelope<Name, Payload> {
  return {
    eventId: randomUUID(),
    eventName: input.name,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    aggregateId: input.aggregateId,
    correlationId: input.correlationId ?? null,
    payload: input.payload,
  };
}
