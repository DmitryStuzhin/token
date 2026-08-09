import type { ContentRepository, PublicTask } from './ports.js';

export class ListPublicTasks {
  public constructor(private readonly repository: ContentRepository) {}

  public execute(subjectId?: string): readonly PublicTask[] {
    const tasks = this.repository.publicTasks();
    return subjectId ? tasks.filter((task) => task.subjectId === subjectId) : tasks;
  }
}
