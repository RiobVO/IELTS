-- 0062_passage_order_unique :: up
-- BACKLOG W2-13 (deferred from the 2026-07-17 monetization wave): persist.ts
-- guarantees unique passage "order" per content item on the write path, but the
-- DB itself held no invariant — a future writer (or a manual fix-up) could stack
-- two passages on one slot and the catalog/runner would render them in an
-- undefined relative order. Prod checked duplicate-free before this migration.

ALTER TABLE passage
  ADD CONSTRAINT passage_content_item_order_key UNIQUE (content_item_id, "order");
