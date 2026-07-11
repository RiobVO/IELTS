-- 0052_preorder :: down
-- Полный реверт: политика и гранты уходят вместе с таблицей; enum'ов не заводилось
-- (tier переиспользует user_tier, он принадлежит 0000).
DROP TABLE IF EXISTS preorder;
