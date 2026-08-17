-- 0053_referral_invitee_unique :: up
-- Реферал через Google OAuth (2026-07-11): `handle_new_user` (0005) линкует
-- реферала из ref_code в auth-метадате, которую email-signup передаёт, а Google
-- OAuth-обмен — никогда (Google пишет raw_user_meta_data своими полями). Новый
-- путь линковки — app-code linkOAuthReferral (src/lib/progress/referral.ts),
-- вызывается из /auth/callback. Идемпотентность триггера держится на
-- `WHERE NOT EXISTS` внутри одной SECURITY DEFINER-транзакции сигнапа — у
-- app-кода такой гарантии нет (повторный GET на callback реально возможен).
-- UNIQUE(invitee_id) — тот же паттерн, что sprint_signup.user_id (0051):
-- constraint + onConflictDoNothing вместо check-then-insert с гонкой. NULL
-- разрешён многократно (Postgres treats NULLs as distinct) — на будущее, если
-- когда-то появятся status='sent' строки без invitee.

ALTER TABLE referral ADD CONSTRAINT referral_invitee_id_key UNIQUE (invitee_id);
