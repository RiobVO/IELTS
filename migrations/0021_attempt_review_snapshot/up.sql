-- 0021_attempt_review_snapshot :: up
-- D3: стабильный разбор попытки. /result раньше пересчитывал review из ЖИВОГО
-- answer_key — при правке контента он «плыл» у уже сдавших. Снимаем snapshot
-- (correct answers + explanation + evidence по каждому вопросу) на момент submit
-- и читаем его на /result.
--
-- SERVER-ONLY, залочено как answer_key (BRIEF §6.1): RLS включён, гранты сняты,
-- политик для anon/authenticated НЕТ → доступ только у owner/service_role.
-- Критично: без локдауна client-read attempt-связанной строки слил бы gated
-- answer_key/evidence basic-юзеру (минуя tier-gate). 1:1 с attempt (PK =
-- attempt_id), cascade при удалении попытки.

CREATE TABLE attempt_review_snapshot (
  attempt_id uuid PRIMARY KEY REFERENCES attempt(id) ON DELETE CASCADE,
  snapshot   jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE attempt_review_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON attempt_review_snapshot FROM anon, authenticated, PUBLIC;
