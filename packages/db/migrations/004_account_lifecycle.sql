-- migrate:up

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

CREATE TABLE account_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  requested_ip text,
  UNIQUE (user_id, purpose, token_hash)
);
CREATE INDEX account_tokens_lookup_idx ON account_tokens (purpose, token_hash, expires_at);
CREATE INDEX account_tokens_user_idx ON account_tokens (user_id, purpose, created_at DESC);

CREATE TABLE security_events (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX security_events_user_idx ON security_events (user_id, occurred_at DESC);
CREATE INDEX security_events_type_idx ON security_events (event_type, occurred_at DESC);

-- Existing accounts were created before verification existed. Grandfather them
-- to avoid locking every current production user out during the expand migration.
UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at);

-- migrate:down

DROP TABLE security_events;
DROP TABLE account_tokens;
ALTER TABLE users DROP COLUMN email_verified_at;
