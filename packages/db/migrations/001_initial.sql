-- migrate:up
CREATE TABLE users (
  id uuid PRIMARY KEY,
  legacy_id text UNIQUE,
  role text NOT NULL CHECK (role IN ('student','tutor','parent','admin')),
  name text NOT NULL CHECK (length(name) >= 2),
  email text NOT NULL,
  pass_hash text NOT NULL,
  pass_salt text NOT NULL,
  phone text,
  tz text NOT NULL DEFAULT 'Europe/Moscow',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX users_email_ci_uq ON users (lower(email));

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  user_agent text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE student_profiles (
  id uuid PRIMARY KEY,
  legacy_id text UNIQUE,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  grade smallint CHECK (grade BETWEEN 1 AND 11),
  school text,
  started_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id)
);

CREATE TABLE subjects (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  short_name text NOT NULL,
  slug text NOT NULL UNIQUE,
  color text NOT NULL,
  exam jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id)
);

CREATE TABLE tutor_profiles (
  id uuid PRIMARY KEY,
  legacy_id text UNIQUE,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  years_exp integer CHECK (years_exp >= 0),
  rate_minor bigint NOT NULL DEFAULT 0 CHECK (rate_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'RUB',
  meeting_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id)
);

CREATE TABLE tutor_subjects (
  tutor_id uuid NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tutor_id, subject_id)
);

CREATE TABLE topics (
  id uuid PRIMARY KEY,
  legacy_id text UNIQUE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  UNIQUE (subject_id, name)
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY,
  legacy_id text UNIQUE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  number integer NOT NULL CHECK (number > 0),
  topic_id uuid REFERENCES topics(id) ON DELETE SET NULL,
  title text NOT NULL,
  statement text NOT NULL,
  answer text NOT NULL DEFAULT '',
  answer_type text NOT NULL DEFAULT 'string',
  compare_mode text NOT NULL DEFAULT 'exact' CHECK (compare_mode IN ('exact','ci','set','numeric')),
  tolerance double precision NOT NULL DEFAULT 0 CHECK (tolerance >= 0),
  auto_check boolean NOT NULL DEFAULT false,
  difficulty smallint NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 5),
  source text NOT NULL DEFAULT 'import',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id)
);
CREATE INDEX tasks_subject_number_idx ON tasks (subject_id, number);
CREATE INDEX tasks_topic_idx ON tasks (topic_id);

CREATE TABLE enrollments (
  id uuid PRIMARY KEY,
  legacy_id text UNIQUE,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE RESTRICT,
  tutor_id uuid NOT NULL REFERENCES tutor_profiles(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active','paused','closed')),
  started_at date,
  source text,
  invite_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX enrollments_active_uq ON enrollments (student_id, tutor_id, subject_id) WHERE status = 'active';
CREATE INDEX enrollments_tutor_idx ON enrollments (tutor_id, status);
CREATE INDEX enrollments_student_idx ON enrollments (student_id, status);

CREATE TABLE groups (
  id uuid PRIMARY KEY,
  legacy_id text UNIQUE,
  tutor_id uuid NOT NULL REFERENCES tutor_profiles(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  title text NOT NULL,
  level text,
  schedule text,
  capacity integer NOT NULL DEFAULT 8 CHECK (capacity > 0),
  status text NOT NULL CHECK (status IN ('recruiting','active','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id)
);
CREATE INDEX groups_tutor_status_idx ON groups (tutor_id, status);

CREATE TABLE group_members (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE RESTRICT,
  joined_at date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL CHECK (status IN ('active','left','removed')),
  source text,
  invite_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users(id),
  PRIMARY KEY (group_id, student_id)
);
CREATE INDEX group_members_student_idx ON group_members (student_id, status);

CREATE TABLE invites (
  id uuid PRIMARY KEY,
  legacy_id text UNIQUE,
  code text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('enrollment','group','guardian')),
  tutor_id uuid REFERENCES tutor_profiles(id) ON DELETE RESTRICT,
  subject_id uuid REFERENCES subjects(id) ON DELETE RESTRICT,
  group_id uuid REFERENCES groups(id) ON DELETE RESTRICT,
  student_id uuid REFERENCES student_profiles(id) ON DELETE RESTRICT,
  expires_at timestamptz,
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  status text NOT NULL CHECK (status IN ('active','used_up','expired','revoked')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  CHECK (max_uses IS NULL OR used_count <= max_uses)
);
ALTER TABLE enrollments ADD CONSTRAINT enrollments_invite_fk FOREIGN KEY (invite_id) REFERENCES invites(id) ON DELETE SET NULL;
ALTER TABLE group_members ADD CONSTRAINT group_members_invite_fk FOREIGN KEY (invite_id) REFERENCES invites(id) ON DELETE SET NULL;
CREATE INDEX invites_tutor_status_idx ON invites (tutor_id, status);
CREATE INDEX invites_expiry_idx ON invites (expires_at) WHERE status = 'active';

CREATE TABLE lessons (
  id uuid PRIMARY KEY,
  legacy_id text UNIQUE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  tutor_id uuid NOT NULL REFERENCES tutor_profiles(id) ON DELETE RESTRICT,
  enrollment_id uuid REFERENCES enrollments(id) ON DELETE RESTRICT,
  group_id uuid REFERENCES groups(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  duration_min integer NOT NULL DEFAULT 60 CHECK (duration_min BETWEEN 1 AND 480),
  status text NOT NULL CHECK (status IN ('planned','done','moved','cancelled','missed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  CHECK ((enrollment_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer = 1)
);
CREATE INDEX lessons_tutor_starts_idx ON lessons (tutor_id, starts_at);
CREATE INDEX lessons_enrollment_starts_idx ON lessons (enrollment_id, starts_at);
CREATE INDEX lessons_group_starts_idx ON lessons (group_id, starts_at);

CREATE TABLE lesson_links (
  id uuid PRIMARY KEY,
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  type text NOT NULL CHECK (type IN ('call','board','material')),
  label text NOT NULL,
  url text NOT NULL CHECK (url ~ '^https?://'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  UNIQUE (lesson_id, position)
);

CREATE TABLE lesson_tasks (
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  PRIMARY KEY (lesson_id, task_id),
  UNIQUE (lesson_id, position)
);

CREATE TABLE lesson_notes (
  id uuid PRIMARY KEY,
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  visibility text NOT NULL CHECK (visibility IN ('private','student','group')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX lesson_notes_lesson_idx ON lesson_notes (lesson_id, visibility);
CREATE UNIQUE INDEX lesson_notes_import_uq ON lesson_notes (lesson_id, author_user_id, visibility, body);

CREATE TABLE lesson_attendance (
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('present','absent','moved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users(id),
  PRIMARY KEY (lesson_id, student_id)
);

CREATE TABLE assignments (
  id uuid PRIMARY KEY,
  legacy_id text UNIQUE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  enrollment_id uuid REFERENCES enrollments(id) ON DELETE RESTRICT,
  group_id uuid REFERENCES groups(id) ON DELETE RESTRICT,
  lesson_id uuid REFERENCES lessons(id) ON DELETE SET NULL,
  title text NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','published','closed','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  CHECK ((enrollment_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer = 1)
);
CREATE INDEX assignments_enrollment_due_idx ON assignments (enrollment_id, due_at);
CREATE INDEX assignments_group_due_idx ON assignments (group_id, due_at);

CREATE TABLE assignment_tasks (
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  PRIMARY KEY (assignment_id, task_id),
  UNIQUE (assignment_id, position)
);

CREATE TABLE attempts (
  id uuid PRIMARY KEY,
  legacy_id text UNIQUE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  context text NOT NULL CHECK (context IN ('lesson','homework','mock')),
  lesson_id uuid REFERENCES lessons(id) ON DELETE RESTRICT,
  assignment_id uuid REFERENCES assignments(id) ON DELETE RESTRICT,
  group_id uuid REFERENCES groups(id) ON DELETE RESTRICT,
  code text NOT NULL DEFAULT '',
  answer text NOT NULL DEFAULT '',
  tries integer NOT NULL DEFAULT 0 CHECK (tries >= 0),
  is_correct boolean,
  first_try_correct boolean,
  active_seconds integer NOT NULL DEFAULT 0 CHECK (active_seconds BETWEEN 0 AND 21600),
  status text NOT NULL CHECK (status IN ('issued','in_progress','submitted','returned','resubmitted','checked')),
  started_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX attempts_business_uq ON attempts (
  student_id, task_id, COALESCE(assignment_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(lesson_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE INDEX attempts_student_updated_idx ON attempts (student_id, updated_at DESC);
CREATE INDEX attempts_lesson_idx ON attempts (lesson_id);
CREATE INDEX attempts_assignment_idx ON attempts (assignment_id);
CREATE INDEX attempts_review_queue_idx ON attempts (status, submitted_at) WHERE status IN ('submitted','resubmitted');

CREATE TABLE attempt_reviews (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  reviewer_tutor_id uuid NOT NULL REFERENCES tutor_profiles(id) ON DELETE RESTRICT,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 10),
  comment text NOT NULL DEFAULT '',
  decision text NOT NULL CHECK (decision IN ('checked','returned')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX attempt_reviews_attempt_time_uq ON attempt_reviews (attempt_id, created_at);

CREATE TABLE attempt_history (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by uuid REFERENCES users(id),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX attempt_history_attempt_time_uq ON attempt_history (attempt_id, created_at);

CREATE TABLE goals (
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  target_score integer CHECK (target_score BETWEEN 0 AND 100),
  exam_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users(id),
  PRIMARY KEY (student_id, subject_id)
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY,
  legacy_id text UNIQUE,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE RESTRICT,
  payer_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  plan text NOT NULL,
  lessons_left integer NOT NULL DEFAULT 0 CHECK (lessons_left >= 0),
  lessons_total integer NOT NULL DEFAULT 0 CHECK (lessons_total >= 0),
  price_minor bigint NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'RUB',
  next_charge_at timestamptz,
  status text NOT NULL CHECK (status IN ('active','paused','cancelled','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  CHECK (lessons_left <= lessons_total)
);
CREATE INDEX subscriptions_student_status_idx ON subscriptions (student_id, status);

CREATE TABLE notification_prefs (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  handle text,
  minutes_before integer CHECK (minutes_before IS NULL OR minutes_before >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users(id),
  PRIMARY KEY (user_id, channel)
);

CREATE TABLE mock_exams (
  id uuid PRIMARY KEY,
  legacy_id text UNIQUE,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  variant text,
  taken_at timestamptz,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id)
);

CREATE TABLE legacy_id_map (
  source_table text NOT NULL,
  legacy_id text NOT NULL,
  target_id uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, legacy_id),
  UNIQUE (source_table, target_id)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_name text NOT NULL,
  event_version integer NOT NULL CHECK (event_version > 0),
  payload jsonb NOT NULL,
  correlation_id text,
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  processed_at timestamptz,
  last_error text
);
CREATE INDEX outbox_pending_idx ON outbox_events (available_at, occurred_at) WHERE processed_at IS NULL;

CREATE TABLE background_jobs (
  id uuid PRIMARY KEY,
  job_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX background_jobs_ready_idx ON background_jobs (run_at, created_at) WHERE status = 'queued';

CREATE TABLE audit_log (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_actor_idx ON audit_log (actor_user_id, created_at DESC);

-- migrate:down
DROP TABLE IF EXISTS audit_log, background_jobs, outbox_events, legacy_id_map,
  mock_exams, notification_prefs, subscriptions, goals, attempt_history,
  attempt_reviews, attempts, assignment_tasks, assignments, lesson_attendance,
  lesson_notes, lesson_tasks, lesson_links, lessons, invites, group_members,
  groups, enrollments, tasks, topics, tutor_subjects, tutor_profiles,
  subjects, student_profiles, sessions, users CASCADE;
