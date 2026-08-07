-- 0036_question_column_grants :: up
-- N4 (AUDIT_2026-07-02): question.evidence_ref — id абзаца-доказательства, т.е.
-- подсказка к правильному ответу — наследовал табличный anon-SELECT из 0001 и был
-- читаем ДО сабмита (`/rest/v1/question?select=evidence_ref`). Колонку заполняет
-- только legacy single-reading парсер (parse-test.ts), на проде published-строк с
-- non-null значением ноль (скан 2026-07-02) — фикс профилактический. Зеркало 0035:
-- column-level grant, клиенту остаются только колонки, которые реально читает
-- RLS-путь (app/app/reading/[id]/page.tsx; content_item_id нужен для WHERE-фильтра).
REVOKE SELECT ON question FROM anon, authenticated;
GRANT SELECT (
  id, content_item_id, passage_id, number, qtype, prompt_html, options, group_key, "order"
) ON question TO anon, authenticated;
