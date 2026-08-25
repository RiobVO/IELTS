-- 0058_referral_cap_bonus :: up
-- Реферальная награда переезжает с XP на подъём Basic-капа (growth-волна 1, G1-1):
-- каждый приглашённый, дошедший до rated-первой попытки, даёт +1 mock-старт/неделю
-- ОБОИМ участникам пары. Слагаемое хранится денормализованно на profile, а не
-- считается COUNT'ом по referral: авторитетная проверка капа живёт внутри
-- транзакции startAttempt, где строка profile УЖЕ залочена SELECT ... FOR UPDATE —
-- колонка приезжает тем же чтением, без лишнего round-trip на горячем пути.
--
-- Потолок (3) применяется в приложении при инкременте (LEAST в maybeRewardReferral)
-- и повторно при чтении (mockWeeklyLimit в src/lib/tiers.ts, REFERRAL_MOCK_BONUS_MAX):
-- CHECK-констрейнт сознательно не ставим — снижение потолка тогда потребовало бы
-- миграции данных, а не правки одной константы.
--
-- Колонка наследует RLS-постуру profile (owner-only SELECT, все записи owner-path
-- через Drizzle) — новых грантов/политик не нужно, как у 0049 exam_date.

ALTER TABLE profile ADD COLUMN referral_cap_bonus integer NOT NULL DEFAULT 0;

-- Бэкфилл: рефералы, награждённые ДО этой миграции, обязаны получить свой бонус —
-- иначе награда была бы только у будущих пар, а у прошлых молча пропала. Обе
-- стороны пары: приглашающий получает по +1 за каждого активированного, приглашённый
-- — ровно +1 (у него не более одной referral-строки, UNIQUE(invitee_id) из 0053).
WITH earned AS (
  SELECT inviter_id AS user_id, count(*)::int AS n
    FROM referral WHERE status = 'rewarded' GROUP BY inviter_id
  UNION ALL
  SELECT invitee_id AS user_id, 1 AS n
    FROM referral WHERE status = 'rewarded' AND invitee_id IS NOT NULL
), total AS (
  SELECT user_id, LEAST(sum(n), 3)::int AS bonus FROM earned GROUP BY user_id
)
UPDATE profile p SET referral_cap_bonus = t.bonus
  FROM total t WHERE t.user_id = p.id;
