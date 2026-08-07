-- 0036_question_column_grants :: down
-- Возврат к табличному SELECT-гранту из 0001 (RLS-политика
-- question_select_published в up не менялась — только гранты).
REVOKE SELECT ON question FROM anon, authenticated;
GRANT SELECT ON question TO anon, authenticated;
