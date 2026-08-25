-- 0060_attempt_share_token :: down
-- Полный откат: индекс уходит вместе с колонкой, все выданные ссылки перестают
-- существовать (это и есть желаемое поведение отката фичи шеринга).

DROP INDEX IF EXISTS attempt_share_token_key;
ALTER TABLE attempt DROP COLUMN IF EXISTS share_token;
