-- 0061_telegram_link :: up
-- Связка аккаунта с чатом студенческого Telegram-бота (growth-волна 2, G2-1).
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ КОЛОНКА В profile. Строка живёт своим циклом:
-- появляется при запросе кода, «дозревает» до связки, удаляется по /stop —
-- и содержит короткоживущие секреты (хеш кода привязки), которым не место в
-- профиле, читаемом на каждой странице.
--
-- ГРАНИЦА БЕЗОПАСНОСТИ. Админский бот импорта (app/api/telegram/webhook) стоит на
-- whitelist'е Telegram user_id, потому что пишет owner-path в обход RLS. Здесь бот
-- открыт всем, поэтому chat_id сам по себе не значит НИЧЕГО: чат получает данные
-- аккаунта только после обмена одноразового кода, который выдаёт залогиненный юзер
-- у себя в профиле. Код хранится ХЕШЕМ (sha256) и с TTL — из строки нельзя достать
-- ссылку-приглашение, даже получив доступ на чтение.
--
-- RLS-постура как у mistake_review/saved_word (per-user owner-стейт): запись ТОЛЬКО
-- серверными путями (server action профиля + webhook, оба Drizzle owner-path),
-- клиенту — SELECT своих строк, чтобы страница профиля показывала состояние связки.
-- Гранты secure-by-default: сначала REVOKE ALL (Supabase раздаёт широкие
-- default-privileges новым таблицам), затем точечный GRANT SELECT.
-- Таблица 38-я (см. SCHEMA_NOTES.md).

CREATE TABLE telegram_link (
  user_id           uuid PRIMARY KEY REFERENCES profile (id) ON DELETE CASCADE,
  -- Telegram chat_id. NULL — код выдан, но обмен ещё не состоялся. bigint: id чатов
  -- давно вышли за int4.
  chat_id           bigint UNIQUE,
  -- sha256 одноразового кода привязки (hex). NULL после успешного обмена — код
  -- сгорает, повторно им связаться нельзя.
  code_hash         text,
  code_expires_at   timestamptz,
  linked_at         timestamptz,
  -- Ожидаемый ответ на «вопрос дня» со свободным вводом: (тест, номер вопроса).
  -- NULL — бот ничего не ждёт, любой текст трактуется как команда/шум.
  pending_content_item_id uuid REFERENCES content_item (id) ON DELETE SET NULL,
  pending_question_number integer,
  pending_asked_at  timestamptz,
  -- UTC-день последней отправки — идемпотентность ежедневной рассылки: повторный
  -- прогон крона в тот же день не пишет второй раз (см. daily nudge).
  last_nudge_on     date,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Единственный горячий запрос вебхука: «кто этот чат». UNIQUE выше уже даёт индекс,
-- отдельного не нужно. Ежедневная рассылка сканирует связанные строки по дню:
CREATE INDEX telegram_link_nudge_idx ON telegram_link (last_nudge_on)
  WHERE chat_id IS NOT NULL;
-- FK-индекс под ON DELETE SET NULL при удалении теста.
CREATE INDEX telegram_link_pending_content_idx ON telegram_link (pending_content_item_id);

ALTER TABLE telegram_link ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON telegram_link FROM anon, authenticated, PUBLIC;
GRANT SELECT ON telegram_link TO authenticated;
GRANT ALL ON telegram_link TO service_role;
-- Читать своё состояние связки — да; менять его может только сервер.
CREATE POLICY telegram_link_select_own ON telegram_link
  FOR SELECT TO authenticated USING (user_id = auth.uid());
