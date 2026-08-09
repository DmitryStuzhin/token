-- migrate:up

ALTER TABLE tasks ADD COLUMN task_type text NOT NULL DEFAULT 'answer'
  CHECK (task_type IN ('answer','programming','files'));
ALTER TABLE tasks ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- migrate:down

ALTER TABLE tasks DROP COLUMN attachments;
ALTER TABLE tasks DROP COLUMN task_type;
