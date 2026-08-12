-- migrate:up
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS ended_at date;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS status_reason text;
CREATE TABLE enrollment_history (
  id uuid PRIMARY KEY, enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  from_status text, to_status text NOT NULL, reason text, changed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_status_check;
ALTER TABLE group_members ADD CONSTRAINT group_members_status_check
  CHECK (status IN ('waiting','active','left','removed'));
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS old_assignments_policy text NOT NULL DEFAULT 'from_join_date'
  CHECK (old_assignments_policy IN ('none','from_join_date','all'));
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS recurrence_id uuid;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS recurrence_rule jsonb;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS status_reason text;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS original_starts_at timestamptz;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS opens_at timestamptz;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS late_policy text NOT NULL DEFAULT 'allow'
  CHECK (late_policy IN ('allow','block','allow_with_mark'));
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS rubric jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS rubric_scores jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE mock_exams ADD COLUMN IF NOT EXISTS scale_version text NOT NULL DEFAULT 'v1';
CREATE TABLE score_scales (
  subject_id uuid NOT NULL REFERENCES subjects(id), version text NOT NULL,
  mapping jsonb NOT NULL, effective_from date NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(subject_id,version)
);

-- migrate:down
DROP TABLE IF EXISTS score_scales;
ALTER TABLE mock_exams DROP COLUMN IF EXISTS scale_version;
ALTER TABLE attempts DROP COLUMN IF EXISTS rubric_scores;
ALTER TABLE attempts DROP COLUMN IF EXISTS rubric;
ALTER TABLE assignments DROP COLUMN IF EXISTS late_policy;
ALTER TABLE assignments DROP COLUMN IF EXISTS opens_at;
ALTER TABLE lessons DROP COLUMN IF EXISTS original_starts_at;
ALTER TABLE lessons DROP COLUMN IF EXISTS status_reason;
ALTER TABLE lessons DROP COLUMN IF EXISTS recurrence_rule;
ALTER TABLE lessons DROP COLUMN IF EXISTS recurrence_id;
ALTER TABLE group_members DROP COLUMN IF EXISTS old_assignments_policy;
DROP TABLE IF EXISTS enrollment_history;
ALTER TABLE enrollments DROP COLUMN IF EXISTS status_reason;
ALTER TABLE enrollments DROP COLUMN IF EXISTS ended_at;
