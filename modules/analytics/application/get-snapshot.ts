import type { AnalyticsReadRepository } from './ports.js';

export class GetSnapshot<User, Snapshot> {
  public constructor(private readonly repository: AnalyticsReadRepository<User, Snapshot>) {}

  public execute(user: User | null): Snapshot {
    return this.repository.snapshot(user);
  }
}
