-- 0059_content_item_published_at :: down
-- Полный откат: потребители (каталог/витрина) снова падают на created_at.

ALTER TABLE content_item DROP COLUMN IF EXISTS published_at;
