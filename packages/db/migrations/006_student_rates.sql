-- migrate:up
CREATE TABLE student_rate_history (
  tutor_id uuid NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  rate_minor bigint NOT NULL CHECK (rate_minor >= 0),
  effective_at date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tutor_id, student_id, subject_id, effective_at)
);
CREATE INDEX student_rate_history_student_idx ON student_rate_history (student_id);

-- migrate:down
DROP TABLE student_rate_history;
