-- migrate:up

-- Сцена доски хранится целиком одной строкой на занятие: холст занятия — это
-- один документ, который читают и переписывают только целиком. Хранить его
-- поэлементно значило бы завести таблицу, растущую на каждый штрих.
CREATE TABLE lesson_boards (
  lesson_id uuid PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:down

DROP TABLE lesson_boards;
