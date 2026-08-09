CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS subjects (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  base_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id text NOT NULL REFERENCES subjects(id),
  exam_number smallint NOT NULL CHECK (exam_number BETWEEN 1 AND 99),
  title text NOT NULL,
  difficulty smallint CHECK (difficulty BETWEEN 1 AND 3),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  version integer NOT NULL,
  statement_html text NOT NULL,
  statement_text text NOT NULL,
  answer text,
  answer_type text NOT NULL DEFAULT 'string',
  compare_mode text NOT NULL DEFAULT 'exact',
  solution_html text,
  content_hash char(64) NOT NULL,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id, version),
  UNIQUE(task_id, content_hash)
);

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_current_version_id_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_current_version_id_fkey
  FOREIGN KEY (current_version_id) REFERENCES task_versions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS source_tasks (
  source_id uuid NOT NULL REFERENCES sources(id),
  external_id text NOT NULL,
  task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  remote_updated_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id, external_id)
);

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 char(64) NOT NULL UNIQUE,
  storage_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  media_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_version_assets (
  task_version_id uuid NOT NULL REFERENCES task_versions(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id),
  kind text NOT NULL CHECK (kind IN ('image','attachment')),
  original_url text,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY(task_version_id, asset_id)
);

CREATE TABLE IF NOT EXISTS import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id),
  status text NOT NULL CHECK (status IN ('running','completed','partial','failed')),
  requested_ids jsonb NOT NULL,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  unchanged_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS import_errors (
  id bigserial PRIMARY KEY,
  import_run_id uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  external_id text,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_subject_number_idx ON tasks(subject_id, exam_number);
CREATE INDEX IF NOT EXISTS task_versions_task_idx ON task_versions(task_id, version DESC);
CREATE INDEX IF NOT EXISTS import_runs_started_idx ON import_runs(started_at DESC);

INSERT INTO subjects(id, name) VALUES ('inf', 'Информатика') ON CONFLICT DO NOTHING;
INSERT INTO sources(code, name, base_url)
VALUES ('kompege', 'КомпЕГЭ', 'https://kompege.ru')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, base_url = EXCLUDED.base_url;
