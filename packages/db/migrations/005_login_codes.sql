-- migrate:up

-- Код живёт в той же строке, что и ссылка: для подтверждения регистрации это
-- один и тот же одноразовый факт, просто предъявить его можно двумя способами.
ALTER TABLE account_tokens ADD COLUMN code_hash text;
ALTER TABLE account_tokens ADD COLUMN attempts integer NOT NULL DEFAULT 0;

ALTER TABLE account_tokens DROP CONSTRAINT account_tokens_purpose_check;
ALTER TABLE account_tokens ADD CONSTRAINT account_tokens_purpose_check
  CHECK (purpose IN ('verify_email','reset_password','login_code'));

CREATE INDEX account_tokens_code_idx ON account_tokens (user_id, purpose, code_hash);

-- Доверенное устройство избавляет от кода на каждом входе. Хранится только
-- SHA-256 куки: утечка таблицы не даёт войти ни под кем.
CREATE TABLE trusted_devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  user_agent text
);
CREATE INDEX trusted_devices_user_idx ON trusted_devices (user_id, expires_at DESC);

-- migrate:down

DROP TABLE trusted_devices;
DROP INDEX account_tokens_code_idx;
-- Иначе восстановленный CHECK не примет уже существующие строки login_code.
DELETE FROM account_tokens WHERE purpose = 'login_code';
ALTER TABLE account_tokens DROP CONSTRAINT account_tokens_purpose_check;
ALTER TABLE account_tokens ADD CONSTRAINT account_tokens_purpose_check
  CHECK (purpose IN ('verify_email','reset_password'));
ALTER TABLE account_tokens DROP COLUMN attempts;
ALTER TABLE account_tokens DROP COLUMN code_hash;
