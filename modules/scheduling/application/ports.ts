import type { LessonStatus } from '../domain/lesson.js';

export interface VersionedLesson {
  readonly id: string;
  readonly tutorId: string;
  readonly status: LessonStatus;
  readonly version: number;
}

export interface SchedulingRepository {
  findLesson(id: string): Promise<VersionedLesson | null>;
  saveLessonStatus(lesson: VersionedLesson, status: LessonStatus): Promise<void>;
}
