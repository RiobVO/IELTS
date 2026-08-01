-- 0026_writing_task_part :: up
-- Task 1 support for Writing Lab. A writing_task is now either Task 1 (chart/graph/
-- diagram response, image-backed) or Task 2 (essay). Additive + defaulted so every
-- existing row stays Task 2 — grading/RLS/tier/answer-key model untouched. image_path
-- is the Supabase Storage key of the visual (Task 1 only; NULL for Task 2); it is NOT
-- a secret (it's the prompt's chart), so no answer_key-style lock is needed.

CREATE TYPE writing_task_part AS ENUM ('task1', 'task2');

ALTER TABLE writing_task
  ADD COLUMN IF NOT EXISTS task_part  writing_task_part NOT NULL DEFAULT 'task2',
  ADD COLUMN IF NOT EXISTS image_path text;
