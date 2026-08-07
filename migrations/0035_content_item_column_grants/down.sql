-- 0035_content_item_column_grants :: down
-- Возврат к табличному SELECT-гранту из 0001 (RLS-политика
-- content_item_select_published в up не менялась — только гранты).
REVOKE SELECT ON content_item FROM anon, authenticated;
GRANT SELECT ON content_item TO anon, authenticated;
