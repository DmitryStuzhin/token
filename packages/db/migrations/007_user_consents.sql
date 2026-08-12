-- migrate:up

CREATE TABLE user_consents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('personal_data','terms')),
  document_version text NOT NULL,
  accepted_at timestamptz NOT NULL,
  ip text,
  user_agent text,
  UNIQUE (user_id, consent_type, document_version)
);
CREATE INDEX user_consents_user_idx ON user_consents (user_id, accepted_at DESC);

-- migrate:down

DROP TABLE user_consents;
