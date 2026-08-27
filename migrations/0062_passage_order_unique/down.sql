-- 0062_passage_order_unique :: down
ALTER TABLE passage DROP CONSTRAINT IF EXISTS passage_content_item_order_key;
