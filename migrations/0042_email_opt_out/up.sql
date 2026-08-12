-- 0042_email_opt_out :: up
-- Weekly digest opt-out (BRIEF §11/§12.1 step 2: email provider -> verify -> digest).
-- Single boolean column on the existing `profile` table — no new grants/policies:
-- the column inherits profile's RLS posture (owner-only SELECT/UPDATE), writes go
-- only through the owner-path unsubscribe server route. DEFAULT false = opted in
-- by default; existing rows stay opted in until a user unsubscribes.

ALTER TABLE profile ADD COLUMN weekly_digest_opt_out boolean NOT NULL DEFAULT false;
