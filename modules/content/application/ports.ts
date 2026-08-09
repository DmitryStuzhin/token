export interface PublicTask {
  readonly id: string;
  readonly subjectId: string;
  readonly number: number;
  readonly title: string;
  readonly statement: string;
  readonly autoCheck: boolean;
}

export interface ContentRepository {
  publicTasks(): readonly PublicTask[];
}
