-- migrate:up

ALTER TABLE lesson_notes DROP CONSTRAINT IF EXISTS lesson_notes_visibility_check;
ALTER TABLE lesson_notes ADD CONSTRAINT lesson_notes_visibility_check
  CHECK (visibility IN ('private','student','group','parent'));

-- migrate:down

UPDATE lesson_notes SET visibility = 'student' WHERE visibility = 'parent';
ALTER TABLE lesson_notes DROP CONSTRAINT lesson_notes_visibility_check;
ALTER TABLE lesson_notes ADD CONSTRAINT lesson_notes_visibility_check
  CHECK (visibility IN ('private','student','group'));
