import { DomainError } from './errors.js';

export type TransitionMap<State extends string> = Readonly<
  Record<State, readonly State[]>
>;

export function assertTransition<State extends string>(
  aggregate: string,
  transitions: TransitionMap<State>,
  from: State,
  to: State,
): void {
  if (from === to) return;
  if (!transitions[from].includes(to)) {
    throw new DomainError(
      'INVALID_TRANSITION',
      `Недопустимый переход ${aggregate}: ${from} → ${to}`,
    );
  }
}
