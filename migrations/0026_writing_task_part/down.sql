-- 0026_writing_task_part :: down
-- Drop the Task 1 columns, then the enum type they depend on. prompt / category /
-- status / tier_required and all existing rows are untouched.
ALTER TABLE writing_task
  DROP COLUMN IF EXISTS image_path,
  DROP COLUMN IF EXISTS task_part;

DROP TYPE IF EXISTS writing_task_part;
