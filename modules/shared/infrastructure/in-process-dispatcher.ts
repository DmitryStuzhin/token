import type {
  EventHandler,
  EventName,
  EventPublisher,
  PlatformEvent,
} from '../application/events.js';

export class InProcessEventDispatcher implements EventPublisher {
  readonly #handlers = new Map<EventName, Set<EventHandler>>();

  public subscribe(name: EventName, handler: EventHandler): () => void {
    const handlers = this.#handlers.get(name) ?? new Set<EventHandler>();
    handlers.add(handler);
    this.#handlers.set(name, handlers);
    return () => handlers.delete(handler);
  }

  public async publish(event: PlatformEvent): Promise<void> {
    const handlers = this.#handlers.get(event.eventName) ?? [];
    await Promise.all([...handlers].map(async (handler) => handler(event)));
  }
}
