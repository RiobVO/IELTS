-- 0050_answer_key_l1 :: down
ALTER TABLE content_item DROP COLUMN IF EXISTS l1_status;
ALTER TABLE answer_key DROP COLUMN IF EXISTS explanation_ru;
DROP TYPE IF EXISTS l1_gen_status;
