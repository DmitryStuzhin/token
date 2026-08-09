export interface AnalyticsReadRepository<User, Snapshot> {
  snapshot(user: User | null): Snapshot;
}
