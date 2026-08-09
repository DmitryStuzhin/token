-- migrate:up

ALTER FUNCTION rebuild_read_models() RENAME TO rebuild_read_models_base;

CREATE FUNCTION apply_answer_error_stats() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  WITH facts AS (
    SELECT student_id, subject_id,
      count(*) FILTER (
        WHERE status IN ('submitted','checked')
          OR (tries > 0 AND is_correct IS NOT NULL)
      )::integer AS evaluated_total,
      count(*) FILTER (
        WHERE is_correct
          AND (status IN ('submitted','checked') OR tries > 0)
      )::integer AS correct_total,
      max(COALESCE(submitted_at, started_at)) FILTER (
        WHERE status IN ('submitted','checked')
          OR (tries > 0 AND is_correct IS NOT NULL)
      ) AS last_evaluated_at
    FROM attempts
    GROUP BY student_id, subject_id
  )
  UPDATE student_subject_stats stats SET
    solved_total = COALESCE(facts.evaluated_total, 0),
    checked_total = COALESCE(facts.evaluated_total, 0),
    correct_total = COALESCE(facts.correct_total, 0),
    accuracy = CASE WHEN COALESCE(facts.evaluated_total, 0) = 0 THEN NULL
      ELSE round(facts.correct_total * 100.0 / facts.evaluated_total)::integer END,
    last_activity_at = COALESCE(facts.last_evaluated_at, stats.last_activity_at),
    updated_at = now()
  FROM facts
  WHERE stats.student_id = facts.student_id AND stats.subject_id = facts.subject_id;
END;
$$;

CREATE FUNCTION rebuild_read_models() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM rebuild_read_models_base();
  PERFORM apply_answer_error_stats();
END;
$$;

CREATE OR REPLACE FUNCTION refresh_read_models_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM rebuild_read_models();
  RETURN NULL;
END;
$$;

SELECT rebuild_read_models();

-- migrate:down

DROP FUNCTION rebuild_read_models();
DROP FUNCTION apply_answer_error_stats();
ALTER FUNCTION rebuild_read_models_base() RENAME TO rebuild_read_models;
CREATE OR REPLACE FUNCTION refresh_read_models_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM rebuild_read_models();
  RETURN NULL;
END;
$$;
SELECT rebuild_read_models();
