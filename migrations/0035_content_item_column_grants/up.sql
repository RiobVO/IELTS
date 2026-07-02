-- 0035_content_item_column_grants :: up
-- N1/N9 (AUDIT_2026-07-02): табличный GRANT SELECT из 0001 отдавал anon/authenticated
-- ВСЕ колонки content_item через Supabase REST — включая runner_html (ключи оттуда
-- вырезает только import-time санитайзер, т.е. единственный хрупкий барьер) и
-- служебные source_file_path / import_warnings / reviewed_at / created_by.
-- RLS-путь приложения эти колонки не читает: каждое чтение runner_html — owner-side
-- Drizzle (exam page, runner route, telegram-бот, каталожный has_runner), а
-- единственный клиентский запрос выбирает id,title,category,duration_seconds,
-- tier_required (app/app/reading/[id]/page.tsx). Переходим на column-level grants:
-- новые колонки рождаются НЕчитаемыми, пока их не открыли явно (secure by default).
REVOKE SELECT ON content_item FROM anon, authenticated;
GRANT SELECT (
  id, section, category, title, duration_seconds, tier_required, band_type,
  question_types, band_scale, status, version, difficulty_rating, difficulty_count,
  created_at
) ON content_item TO anon, authenticated;
