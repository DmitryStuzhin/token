import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { ExtractedDataset, LegacyRow, TargetBatch, TransformedDataset } from './types.js';

const scalarString = (value: unknown, fallback = ''): string => {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  throw new TypeError('Expected a scalar SQLite value');
};
const string = (row: LegacyRow, key: string, fallback = ''): string =>
  scalarString(row[key], fallback);
const nullable = (row: LegacyRow, key: string): string | null => {
  const value = row[key];
  return value == null || value === '' ? null : scalarString(value);
};
const integer = (row: LegacyRow, key: string, fallback = 0): number => {
  const value = Number(row[key] ?? fallback);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
};
const bool = (row: LegacyRow, key: string): boolean => Boolean(integer(row, key));
const json = (row: LegacyRow, key: string, fallback: unknown): unknown => {
  try {
    const value = row[key];
    return value == null || value === '' ? fallback : JSON.parse(scalarString(value));
  } catch {
    return fallback;
  }
};
const timestamp = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  const date = new Date(scalarString(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const date = (value: unknown): string | null => {
  const valueTimestamp = timestamp(value);
  return valueTimestamp?.slice(0, 10) ?? null;
};

export type ExistingMappings = ReadonlyMap<string, string>;

export function mappingKey(table: string, legacyId: string): string {
  return `${table}\u0000${legacyId}`;
}

export function transformDataset(
  extracted: ExtractedDataset,
  existingMappings: ExistingMappings = new Map(),
): TransformedDataset {
  const warnings: string[] = [];
  const ids = new Map(existingMappings);
  const table = (name: string): readonly LegacyRow[] => extracted.tables[name] ?? [];
  const id = (name: string, legacy: unknown): string => {
    const legacyId = scalarString(legacy);
    if (!legacyId) throw new Error(`Missing legacy id for ${name}`);
    const key = mappingKey(name, legacyId);
    const found = ids.get(key);
    if (found) return found;
    const created = uuidv7();
    ids.set(key, created);
    return created;
  };
  const optionalId = (name: string, legacy: unknown): string | null =>
    legacy == null || legacy === '' ? null : id(name, legacy);

  for (const [name, rows] of Object.entries(extracted.tables)) {
    for (const row of rows) {
      if (row.id != null) id(name, row.id);
    }
  }

  const now = new Date().toISOString();
  const batches: TargetBatch[] = [];
  const add = (
    name: string,
    rows: readonly Readonly<Record<string, unknown>>[],
    conflictColumns: readonly string[],
  ): void => {
    batches.push({ table: name, rows, conflictColumns });
  };

  add(
    'users',
    table('users').map((row) => ({
      id: id('users', row.id),
      legacy_id: string(row, 'id'),
      role: string(row, 'role'),
      name: string(row, 'name'),
      email: string(row, 'email').toLowerCase(),
      pass_hash: string(row, 'pass_hash'),
      pass_salt: string(row, 'pass_salt'),
      phone: nullable(row, 'phone'),
      tz: string(row, 'tz', 'Europe/Moscow'),
      created_at: timestamp(row.created_at) ?? now,
      updated_at: timestamp(row.created_at) ?? now,
      version: 1,
      created_by: null,
      updated_by: null,
    })),
    ['id'],
  );

  add(
    'subjects',
    table('subjects').map((row) => ({
      id: id('subjects', row.id),
      code: string(row, 'id'),
      name: string(row, 'name'),
      short_name: string(row, 'short'),
      slug: string(row, 'slug'),
      color: string(row, 'color'),
      exam: json(row, 'exam', {}),
      created_at: now,
      updated_at: now,
      version: 1,
      created_by: null,
      updated_by: null,
    })),
    ['id'],
  );

  add(
    'student_profiles',
    table('student_profiles').map((row) => ({
      id: id('student_profiles', row.id),
      legacy_id: string(row, 'id'),
      user_id: id('users', row.user_id),
      grade: integer(row, 'grade', 11),
      school: nullable(row, 'school'),
      started_at: date(row.started_at),
      created_at: now,
      updated_at: now,
      version: 1,
      created_by: null,
      updated_by: null,
    })),
    ['id'],
  );

  add(
    'tutor_profiles',
    table('tutor_profiles').map((row) => ({
      id: id('tutor_profiles', row.id),
      legacy_id: string(row, 'id'),
      user_id: id('users', row.user_id),
      years_exp: integer(row, 'years_exp'),
      rate_minor: integer(row, 'rate') * 100,
      currency: 'RUB',
      meeting_url: nullable(row, 'meeting_url'),
      created_at: now,
      updated_at: now,
      version: 1,
      created_by: null,
      updated_by: null,
    })),
    ['id'],
  );

  add(
    'tutor_subjects',
    table('tutor_profiles').flatMap((row) => {
      const values = json(row, 'subjects', []);
      return Array.isArray(values)
        ? values.map((subject) => ({
            tutor_id: id('tutor_profiles', row.id),
            subject_id: id('subjects', subject),
            created_at: now,
          }))
        : [];
    }),
    ['tutor_id', 'subject_id'],
  );

  add(
    'topics',
    table('topics').map((row) => ({
      id: id('topics', row.id),
      legacy_id: string(row, 'id'),
      subject_id: id('subjects', row.subject_id),
      name: string(row, 'name'),
      created_at: now,
      updated_at: now,
      version: 1,
      created_by: null,
      updated_by: null,
    })),
    ['id'],
  );

  add(
    'tasks',
    table('tasks').map((row) => ({
      id: id('tasks', row.id),
      legacy_id: string(row, 'id'),
      subject_id: id('subjects', row.subject_id),
      number: integer(row, 'number'),
      topic_id: optionalId('topics', row.topic_id),
      title: string(row, 'title'),
      statement: string(row, 'statement'),
      answer: string(row, 'answer'),
      answer_type: string(row, 'answer_type', 'string'),
      compare_mode: string(row, 'compare', 'exact'),
      tolerance: Number(row.tolerance ?? 0),
      auto_check: bool(row, 'auto_check'),
      difficulty: integer(row, 'difficulty', 2),
      source: string(row, 'source', 'import'),
      created_at: now,
      updated_at: now,
      version: 1,
      created_by: null,
      updated_by: null,
    })),
    ['id'],
  );

  add(
    'sessions',
    table('sessions').map((row) => ({
      token_hash: createHash('sha256').update(string(row, 'token')).digest('hex'),
      user_id: id('users', row.user_id),
      created_at: timestamp(row.created_at) ?? now,
      expires_at: timestamp(row.expires_at) ?? now,
      user_agent: nullable(row, 'user_agent'),
    })),
    ['token_hash'],
  );

  add(
    'groups',
    table('groups').map((row) => ({
      id: id('groups', row.id),
      legacy_id: string(row, 'id'),
      tutor_id: id('tutor_profiles', row.tutor_id),
      subject_id: id('subjects', row.subject_id),
      title: string(row, 'title'),
      level: nullable(row, 'level'),
      schedule: nullable(row, 'schedule'),
      capacity: integer(row, 'capacity', 8),
      status: string(row, 'status', 'recruiting'),
      created_at: timestamp(row.created_at) ?? now,
      updated_at: timestamp(row.created_at) ?? now,
      version: 1,
      created_by: null,
      updated_by: null,
    })),
    ['id'],
  );

  add(
    'invites',
    table('invites').map((row) => ({
      id: id('invites', row.id),
      legacy_id: string(row, 'id'),
      code: string(row, 'code'),
      kind: string(row, 'kind'),
      tutor_id: optionalId('tutor_profiles', row.tutor_id),
      subject_id: optionalId('subjects', row.subject_id),
      group_id: optionalId('groups', row.group_id),
      student_id: optionalId('student_profiles', row.student_id),
      expires_at: timestamp(row.expires_at),
      max_uses: row.max_uses == null ? null : integer(row, 'max_uses'),
      used_count: integer(row, 'used_count'),
      status: string(row, 'status', 'active'),
      note: nullable(row, 'note'),
      created_at: timestamp(row.created_at) ?? now,
      updated_at: timestamp(row.created_at) ?? now,
      version: integer(row, 'version', 1),
      created_by: optionalId('users', row.created_by),
      updated_by: null,
    })),
    ['id'],
  );

  add(
    'enrollments',
    table('enrollments').map((row) => ({
      id: id('enrollments', row.id),
      legacy_id: string(row, 'id'),
      student_id: id('student_profiles', row.student_id),
      tutor_id: id('tutor_profiles', row.tutor_id),
      subject_id: id('subjects', row.subject_id),
      status: string(row, 'status', 'active'),
      started_at: date(row.started_at),
      source: nullable(row, 'source'),
      invite_id: optionalId('invites', row.invite_id),
      created_at: now,
      updated_at: now,
      version: 1,
      created_by: null,
      updated_by: null,
    })),
    ['id'],
  );

  add(
    'group_members',
    table('group_members').map((row) => ({
      group_id: id('groups', row.group_id),
      student_id: id('student_profiles', row.student_id),
      joined_at: date(row.joined_at) ?? now.slice(0, 10),
      status: string(row, 'status', 'active'),
      source: nullable(row, 'source'),
      invite_id: optionalId('invites', row.invite_id),
      created_at: now,
      updated_at: now,
      version: 1,
      updated_by: null,
    })),
    ['group_id', 'student_id'],
  );

  const tutorUser = new Map(
    table('tutor_profiles').map((row) => [string(row, 'id'), id('users', row.user_id)]),
  );
  add(
    'lessons',
    table('lessons').map((row) => ({
      id: id('lessons', row.id),
      legacy_id: string(row, 'id'),
      subject_id: id('subjects', row.subject_id),
      tutor_id: id('tutor_profiles', row.tutor_id),
      enrollment_id: optionalId('enrollments', row.enrollment_id),
      group_id: optionalId('groups', row.group_id),
      starts_at: timestamp(row.starts_at) ?? now,
      duration_min: integer(row, 'duration_min', 60),
      status: string(row, 'status', 'planned'),
      created_at: now,
      updated_at: now,
      version: integer(row, 'version', 1),
      created_by: tutorUser.get(string(row, 'tutor_id')) ?? null,
      updated_by: tutorUser.get(string(row, 'tutor_id')) ?? null,
    })),
    ['id'],
  );

  add(
    'lesson_links',
    table('lessons').flatMap((row) => {
      const links = json(row, 'links', []);
      return Array.isArray(links)
        ? links
            .map((value, position) => {
              const link = value as Record<string, unknown>;
              return {
                id: uuidv7(),
                lesson_id: id('lessons', row.id),
                position,
                type: scalarString(link.type, 'material'),
                label: scalarString(link.label, 'Материал'),
                url: scalarString(link.url),
                created_at: now,
                created_by: tutorUser.get(string(row, 'tutor_id')) ?? null,
              };
            })
            .filter((link) => /^https?:\/\//i.test(link.url))
        : [];
    }),
    ['lesson_id', 'position'],
  );

  add(
    'lesson_tasks',
    table('lessons').flatMap((row) => {
      const taskIds = json(row, 'task_ids', []);
      return Array.isArray(taskIds)
        ? taskIds.map((taskId, position) => ({
            lesson_id: id('lessons', row.id),
            task_id: id('tasks', taskId),
            position,
            created_at: now,
            created_by: tutorUser.get(string(row, 'tutor_id')) ?? null,
          }))
        : [];
    }),
    ['lesson_id', 'task_id'],
  );

  add(
    'lesson_notes',
    table('lessons').flatMap((row) => {
      const note = json(row, 'note', null);
      if (!note) return [];
      const body = typeof note === 'string' ? note : JSON.stringify(note);
      const author = tutorUser.get(string(row, 'tutor_id'));
      if (!author) {
        warnings.push(`Lesson ${scalarString(row.id)} note has no author`);
        return [];
      }
      return [
        {
          id: uuidv7(),
          lesson_id: id('lessons', row.id),
          author_user_id: author,
          visibility: 'private',
          body,
          created_at: now,
          updated_at: now,
          version: 1,
        },
      ];
    }),
    ['lesson_id', 'author_user_id', 'visibility', 'body'],
  );

  add(
    'lesson_attendance',
    table('lesson_attendance').map((row) => ({
      lesson_id: id('lessons', row.lesson_id),
      student_id: id('student_profiles', row.student_id),
      status: string(row, 'status', 'present'),
      created_at: now,
      updated_at: now,
      version: 1,
      updated_by: null,
    })),
    ['lesson_id', 'student_id'],
  );

  add(
    'assignments',
    table('assignments').map((row) => ({
      id: id('assignments', row.id),
      legacy_id: string(row, 'id'),
      subject_id: id('subjects', row.subject_id),
      enrollment_id: optionalId('enrollments', row.enrollment_id),
      group_id: optionalId('groups', row.group_id),
      lesson_id: optionalId('lessons', row.lesson_id),
      title: string(row, 'title'),
      due_at: timestamp(row.due_at) ?? now,
      status: string(row, 'status', 'published'),
      created_at: now,
      updated_at: now,
      version: integer(row, 'version', 1),
      created_by: null,
      updated_by: null,
    })),
    ['id'],
  );

  add(
    'assignment_tasks',
    table('assignments').flatMap((row) => {
      const taskIds = json(row, 'task_ids', []);
      return Array.isArray(taskIds)
        ? taskIds.map((taskId, position) => ({
            assignment_id: id('assignments', row.id),
            task_id: id('tasks', taskId),
            position,
            created_at: now,
            created_by: null,
          }))
        : [];
    }),
    ['assignment_id', 'task_id'],
  );

  add(
    'attempts',
    table('attempts').map((row) => ({
      id: id('attempts', row.id),
      legacy_id: string(row, 'id'),
      task_id: id('tasks', row.task_id),
      student_id: id('student_profiles', row.student_id),
      subject_id: id('subjects', row.subject_id),
      context: string(row, 'context', row.lesson_id ? 'lesson' : 'homework'),
      lesson_id: optionalId('lessons', row.lesson_id),
      assignment_id: optionalId('assignments', row.assignment_id),
      group_id: optionalId('groups', row.group_id),
      code: string(row, 'code'),
      answer: string(row, 'answer'),
      tries: integer(row, 'tries'),
      is_correct: row.is_correct == null ? null : bool(row, 'is_correct'),
      first_try_correct: row.first_try_correct == null ? null : bool(row, 'first_try_correct'),
      active_seconds: Math.min(21_600, Math.max(0, integer(row, 'active_seconds'))),
      status: string(row, 'status', 'issued'),
      started_at: timestamp(row.started_at),
      submitted_at: timestamp(row.submitted_at),
      created_at: timestamp(row.started_at) ?? now,
      updated_at: timestamp(row.reviewed_at) ?? timestamp(row.submitted_at) ?? now,
      version: integer(row, 'version', 1),
      created_by: null,
      updated_by: null,
    })),
    ['id'],
  );

  add(
    'attempt_reviews',
    table('attempts').flatMap((row) =>
      row.reviewed_at && row.reviewed_by
        ? [
            {
              id: uuidv7(),
              attempt_id: id('attempts', row.id),
              reviewer_tutor_id: id('tutor_profiles', row.reviewed_by),
              score: integer(row, 'review_score'),
              comment: string(row, 'review_comment'),
              decision: 'checked',
              created_at: timestamp(row.reviewed_at) ?? now,
            },
          ]
        : [],
    ),
    ['attempt_id', 'created_at'],
  );

  add(
    'attempt_history',
    table('attempts').map((row) => ({
      id: uuidv7(),
      attempt_id: id('attempts', row.id),
      from_status: null,
      to_status: string(row, 'status', 'issued'),
      changed_by: null,
      snapshot: { migratedFrom: 'sqlite', tries: integer(row, 'tries') },
      created_at:
        timestamp(row.reviewed_at) ??
        timestamp(row.submitted_at) ??
        timestamp(row.started_at) ??
        now,
    })),
    ['attempt_id', 'created_at'],
  );

  add(
    'goals',
    table('goals').map((row) => ({
      student_id: id('student_profiles', row.student_id),
      subject_id: id('subjects', row.subject_id),
      target_score: row.target_score == null ? null : integer(row, 'target_score'),
      exam_date: date(row.exam_date),
      created_at: now,
      updated_at: now,
      version: 1,
      updated_by: null,
    })),
    ['student_id', 'subject_id'],
  );

  add(
    'subscriptions',
    table('subscriptions').map((row) => ({
      id: id('subscriptions', row.id),
      legacy_id: string(row, 'id'),
      student_id: id('student_profiles', row.student_id),
      payer_user_id: optionalId('users', row.payer_user_id),
      plan: string(row, 'plan'),
      lessons_left: integer(row, 'lessons_left'),
      lessons_total: integer(row, 'lessons_total'),
      price_minor: integer(row, 'price') * 100,
      currency: 'RUB',
      next_charge_at: timestamp(row.next_charge_at),
      status: string(row, 'status', 'active'),
      created_at: now,
      updated_at: now,
      version: 1,
      created_by: null,
      updated_by: null,
    })),
    ['id'],
  );

  add(
    'notification_prefs',
    table('notification_prefs').map((row) => ({
      user_id: id('users', row.user_id),
      channel: string(row, 'channel'),
      enabled: bool(row, 'enabled'),
      handle: nullable(row, 'handle'),
      minutes_before: row.minutes_before == null ? null : integer(row, 'minutes_before'),
      created_at: now,
      updated_at: now,
      version: 1,
      updated_by: null,
    })),
    ['user_id', 'channel'],
  );

  add(
    'mock_exams',
    table('mock_exams').map((row) => ({
      id: id('mock_exams', row.id),
      legacy_id: string(row, 'id'),
      student_id: id('student_profiles', row.student_id),
      subject_id: id('subjects', row.subject_id),
      variant: nullable(row, 'variant'),
      taken_at: timestamp(row.date),
      items: json(row, 'items', []),
      created_at: now,
      updated_at: now,
      version: 1,
      created_by: null,
      updated_by: null,
    })),
    ['id'],
  );

  const legacyRows = [...ids.entries()].map(([key, targetId]) => {
    const [sourceTable = '', legacyId = ''] = key.split('\u0000');
    return {
      source_table: sourceTable,
      legacy_id: legacyId,
      target_id: targetId,
      imported_at: now,
    };
  });
  add('legacy_id_map', legacyRows, ['source_table', 'legacy_id']);

  return {
    sourceFile: extracted.sourceFile,
    transformedAt: now,
    batches,
    sourceCounts: Object.fromEntries(
      Object.entries(extracted.tables).map(([name, rows]) => [name, rows.length]),
    ),
    warnings,
  };
}
