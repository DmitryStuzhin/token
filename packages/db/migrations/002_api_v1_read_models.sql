-- migrate:up

CREATE TABLE idempotency_keys (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation text NOT NULL,
  key text NOT NULL,
  request_hash char(64) NOT NULL,
  status_code integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  PRIMARY KEY (user_id, operation, key),
  CHECK (length(key) BETWEEN 8 AND 200),
  CHECK (status_code IS NULL OR status_code BETWEEN 200 AND 599)
);
CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys(expires_at);

CREATE TABLE student_subject_stats (
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  solved_total integer NOT NULL DEFAULT 0,
  checked_total integer NOT NULL DEFAULT 0,
  correct_total integer NOT NULL DEFAULT 0,
  active_seconds bigint NOT NULL DEFAULT 0,
  accuracy integer,
  last_activity_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, subject_id)
);

CREATE TABLE student_dashboard_view (
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  solved_total integer NOT NULL DEFAULT 0,
  active_seconds bigint NOT NULL DEFAULT 0,
  accuracy integer,
  next_lesson_at timestamptz,
  overdue_assignments integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, subject_id)
);

CREATE TABLE tutor_today_view (
  tutor_id uuid NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  status text NOT NULL,
  student_count integer NOT NULL DEFAULT 0,
  submitted_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tutor_id, lesson_id)
);
CREATE INDEX tutor_today_tutor_starts_idx ON tutor_today_view(tutor_id, starts_at);

CREATE TABLE assignment_progress_view (
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  total_tasks integer NOT NULL DEFAULT 0,
  completed_tasks integer NOT NULL DEFAULT 0,
  correct_tasks integer NOT NULL DEFAULT 0,
  active_seconds bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'issued',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_id)
);
CREATE INDEX assignment_progress_student_idx ON assignment_progress_view(student_id, status);

CREATE OR REPLACE FUNCTION rebuild_read_models() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE student_dashboard_view, tutor_today_view, assignment_progress_view,
    student_subject_stats;

  INSERT INTO student_subject_stats (
    student_id, subject_id, solved_total, checked_total, correct_total,
    active_seconds, accuracy, last_activity_at
  )
  WITH pairs AS (
    SELECT student_id, subject_id FROM enrollments WHERE status = 'active'
    UNION
    SELECT gm.student_id, g.subject_id
      FROM group_members gm JOIN groups g ON g.id = gm.group_id
      WHERE gm.status = 'active' AND g.status <> 'archived'
    UNION
    SELECT student_id, subject_id FROM attempts
  ), facts AS (
    SELECT student_id, subject_id,
      count(*) FILTER (WHERE status IN ('submitted','checked'))::integer AS solved_total,
      count(*) FILTER (WHERE status = 'checked')::integer AS checked_total,
      count(*) FILTER (WHERE status = 'checked' AND is_correct)::integer AS correct_total,
      COALESCE(sum(active_seconds), 0)::bigint AS active_seconds,
      max(COALESCE(submitted_at, started_at)) AS last_activity_at
    FROM attempts GROUP BY student_id, subject_id
  )
  SELECT p.student_id, p.subject_id,
    COALESCE(f.solved_total, 0), COALESCE(f.checked_total, 0),
    COALESCE(f.correct_total, 0), COALESCE(f.active_seconds, 0),
    CASE WHEN COALESCE(f.checked_total, 0) = 0 THEN NULL
      ELSE round(f.correct_total * 100.0 / f.checked_total)::integer END,
    f.last_activity_at
  FROM pairs p LEFT JOIN facts f USING (student_id, subject_id);

  INSERT INTO assignment_progress_view (
    assignment_id, student_id, total_tasks, completed_tasks, correct_tasks,
    active_seconds, status
  )
  WITH targets AS (
    SELECT a.id AS assignment_id, e.student_id
      FROM assignments a JOIN enrollments e ON e.id = a.enrollment_id
    UNION
    SELECT a.id, gm.student_id
      FROM assignments a JOIN group_members gm ON gm.group_id = a.group_id
      WHERE gm.status = 'active'
  ), totals AS (
    SELECT assignment_id, count(*)::integer AS total_tasks
      FROM assignment_tasks GROUP BY assignment_id
  ), facts AS (
    SELECT assignment_id, student_id,
      count(*) FILTER (WHERE status IN ('submitted','checked'))::integer AS completed_tasks,
      count(*) FILTER (WHERE status = 'checked' AND is_correct)::integer AS correct_tasks,
      COALESCE(sum(active_seconds), 0)::bigint AS active_seconds,
      bool_or(status = 'submitted') AS awaiting,
      bool_or(status <> 'issued') AS started
    FROM attempts WHERE assignment_id IS NOT NULL GROUP BY assignment_id, student_id
  )
  SELECT t.assignment_id, t.student_id, COALESCE(total.total_tasks, 0),
    COALESCE(f.completed_tasks, 0), COALESCE(f.correct_tasks, 0),
    COALESCE(f.active_seconds, 0),
    CASE
      WHEN COALESCE(total.total_tasks, 0) > 0
        AND COALESCE(f.completed_tasks, 0) = total.total_tasks
        AND NOT COALESCE(f.awaiting, false) THEN 'checked'
      WHEN COALESCE(f.awaiting, false) THEN 'submitted'
      WHEN a.due_at < now() AND COALESCE(f.completed_tasks, 0) < COALESCE(total.total_tasks, 0)
        THEN 'overdue'
      WHEN COALESCE(f.started, false) THEN 'in_progress'
      ELSE 'issued'
    END
  FROM targets t
  JOIN assignments a ON a.id = t.assignment_id
  LEFT JOIN totals total ON total.assignment_id = t.assignment_id
  LEFT JOIN facts f ON f.assignment_id = t.assignment_id AND f.student_id = t.student_id;

  INSERT INTO student_dashboard_view (
    student_id, subject_id, solved_total, active_seconds, accuracy,
    next_lesson_at, overdue_assignments
  )
  WITH lesson_students AS (
    SELECT l.id AS lesson_id, e.student_id, l.subject_id, l.starts_at, l.status
      FROM lessons l JOIN enrollments e ON e.id = l.enrollment_id
    UNION ALL
    SELECT l.id, gm.student_id, l.subject_id, l.starts_at, l.status
      FROM lessons l JOIN group_members gm ON gm.group_id = l.group_id
      WHERE gm.status = 'active'
  ), next_lessons AS (
    SELECT student_id, subject_id, min(starts_at) AS starts_at
      FROM lesson_students
      WHERE status = 'planned' AND starts_at >= now() - interval '90 minutes'
      GROUP BY student_id, subject_id
  ), overdue AS (
    SELECT ap.student_id, a.subject_id, count(*)::integer AS count
      FROM assignment_progress_view ap JOIN assignments a ON a.id = ap.assignment_id
      WHERE ap.status = 'overdue' GROUP BY ap.student_id, a.subject_id
  )
  SELECT s.student_id, s.subject_id, s.solved_total, s.active_seconds, s.accuracy,
    n.starts_at, COALESCE(o.count, 0)
  FROM student_subject_stats s
  LEFT JOIN next_lessons n USING (student_id, subject_id)
  LEFT JOIN overdue o USING (student_id, subject_id);

  INSERT INTO tutor_today_view (
    tutor_id, lesson_id, starts_at, status, student_count, submitted_count
  )
  SELECT l.tutor_id, l.id, l.starts_at, l.status,
    CASE WHEN l.group_id IS NOT NULL THEN
      (SELECT count(*)::integer FROM group_members gm
        WHERE gm.group_id = l.group_id AND gm.status = 'active')
    ELSE 1 END,
    (SELECT count(*)::integer FROM attempts a
      WHERE a.lesson_id = l.id AND a.status = 'submitted')
  FROM lessons l
  WHERE l.starts_at >= date_trunc('day', now())
    AND l.starts_at < date_trunc('day', now()) + interval '1 day';
END;
$$;

CREATE OR REPLACE FUNCTION refresh_read_models_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM rebuild_read_models();
  RETURN NULL;
END;
$$;

CREATE TRIGGER attempts_refresh_read_models
AFTER INSERT OR UPDATE OR DELETE ON attempts
FOR EACH STATEMENT EXECUTE FUNCTION refresh_read_models_trigger();
CREATE TRIGGER lessons_refresh_read_models
AFTER INSERT OR UPDATE OR DELETE ON lessons
FOR EACH STATEMENT EXECUTE FUNCTION refresh_read_models_trigger();
CREATE TRIGGER assignments_refresh_read_models
AFTER INSERT OR UPDATE OR DELETE ON assignments
FOR EACH STATEMENT EXECUTE FUNCTION refresh_read_models_trigger();
CREATE TRIGGER assignment_tasks_refresh_read_models
AFTER INSERT OR UPDATE OR DELETE ON assignment_tasks
FOR EACH STATEMENT EXECUTE FUNCTION refresh_read_models_trigger();
CREATE TRIGGER enrollments_refresh_read_models
AFTER INSERT OR UPDATE OR DELETE ON enrollments
FOR EACH STATEMENT EXECUTE FUNCTION refresh_read_models_trigger();
CREATE TRIGGER groups_refresh_read_models
AFTER INSERT OR UPDATE OR DELETE ON groups
FOR EACH STATEMENT EXECUTE FUNCTION refresh_read_models_trigger();
CREATE TRIGGER group_members_refresh_read_models
AFTER INSERT OR UPDATE OR DELETE ON group_members
FOR EACH STATEMENT EXECUTE FUNCTION refresh_read_models_trigger();

SELECT rebuild_read_models();

-- migrate:down

DROP TRIGGER IF EXISTS group_members_refresh_read_models ON group_members;
DROP TRIGGER IF EXISTS groups_refresh_read_models ON groups;
DROP TRIGGER IF EXISTS enrollments_refresh_read_models ON enrollments;
DROP TRIGGER IF EXISTS assignment_tasks_refresh_read_models ON assignment_tasks;
DROP TRIGGER IF EXISTS assignments_refresh_read_models ON assignments;
DROP TRIGGER IF EXISTS lessons_refresh_read_models ON lessons;
DROP TRIGGER IF EXISTS attempts_refresh_read_models ON attempts;
DROP FUNCTION IF EXISTS refresh_read_models_trigger();
DROP FUNCTION IF EXISTS rebuild_read_models();
DROP TABLE IF EXISTS assignment_progress_view;
DROP TABLE IF EXISTS tutor_today_view;
DROP TABLE IF EXISTS student_dashboard_view;
DROP TABLE IF EXISTS student_subject_stats;
DROP TABLE IF EXISTS idempotency_keys;
