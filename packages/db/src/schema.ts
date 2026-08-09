import type { ColumnType } from 'kysely';

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type Json = ColumnType<unknown, unknown, unknown>;

interface Versioned {
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
  version: ColumnType<number, number | undefined, number>;
  created_by: string | null;
  updated_by: string | null;
}

export interface UsersTable extends Versioned {
  id: string;
  legacy_id: string | null;
  role: 'student' | 'tutor' | 'parent' | 'admin';
  name: string;
  email: string;
  pass_hash: string;
  pass_salt: string;
  phone: string | null;
  tz: string;
}

export interface SubjectsTable extends Versioned {
  id: string;
  code: string;
  name: string;
  short_name: string;
  slug: string;
  color: string;
  exam: Json;
}

export interface LessonsTable extends Versioned {
  id: string;
  legacy_id: string | null;
  subject_id: string;
  tutor_id: string;
  enrollment_id: string | null;
  group_id: string | null;
  starts_at: Timestamp;
  duration_min: number;
  status: 'planned' | 'done' | 'moved' | 'cancelled' | 'missed';
}

export interface AttemptsTable extends Versioned {
  id: string;
  legacy_id: string | null;
  task_id: string;
  student_id: string;
  subject_id: string;
  context: 'lesson' | 'homework' | 'mock';
  lesson_id: string | null;
  assignment_id: string | null;
  group_id: string | null;
  code: string;
  answer: string;
  tries: number;
  is_correct: boolean | null;
  first_try_correct: boolean | null;
  active_seconds: number;
  status: 'issued' | 'in_progress' | 'submitted' | 'returned' | 'resubmitted' | 'checked';
  started_at: Timestamp | null;
  submitted_at: Timestamp | null;
}

export interface AssignmentsTable extends Versioned {
  id: string;
  legacy_id: string | null;
  subject_id: string;
  enrollment_id: string | null;
  group_id: string | null;
  lesson_id: string | null;
  title: string;
  due_at: Timestamp;
  status: 'draft' | 'published' | 'closed' | 'archived';
}

export interface DatabaseSchema {
  users: UsersTable;
  subjects: SubjectsTable;
  lessons: LessonsTable;
  attempts: AttemptsTable;
  assignments: AssignmentsTable;
}
