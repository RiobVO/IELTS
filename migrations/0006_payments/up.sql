-- 0006_payments :: up
-- Milestone 2D (Tiers + Payment). New `payment` table records each provider
-- charge (Payme / Click / Uzum — BRIEF §4.8) and drives the subscription
-- lifecycle (§11: a completed webhook extends profile.premium_until; a cron
-- downgrade reverts an expired one). Writes are server-only (the webhook +
-- the initiate action run via the Drizzle owner / service_role); clients may
-- read ONLY their own rows. Idempotency is enforced at the row level by
-- UNIQUE (provider, provider_transaction_id) so a replayed webhook can never
-- double-apply a charge.
--
-- NOTE: this is the 14th app table. §5 enumerates 13; `payment` is implied by
-- §4.8 (payment) + §11 (webhook lifecycle), which need a durable, idempotent
-- record. See SCHEMA_NOTES.md "Phase 2D".

CREATE TYPE payment_provider AS ENUM ('payme', 'click', 'uzum');
CREATE TYPE payment_status   AS ENUM ('pending', 'completed', 'failed');

CREATE TABLE payment (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  provider                payment_provider NOT NULL,
  provider_transaction_id text NOT NULL,
  tier                    user_tier NOT NULL,        -- purchased tier (premium|ultra)
  period_months           integer NOT NULL,
  amount                  integer NOT NULL,          -- minor units (tiyin)
  currency                text NOT NULL DEFAULT 'UZS',
  status                  payment_status NOT NULL DEFAULT 'pending',
  applied_until           timestamptz,               -- premium_until this charge set (null until completed)
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- One row per provider charge: the webhook upserts on this key, so a replay
  -- collapses onto the same row instead of creating a duplicate.
  UNIQUE (provider, provider_transaction_id)
);

CREATE INDEX payment_user_created_idx ON payment (user_id, created_at);

-- RLS (BRIEF §6.1): owner-read only; all writes go through the server-privileged
-- path (Drizzle owner / service_role), never the anon/authenticated client.
ALTER TABLE payment ENABLE ROW LEVEL SECURITY;
GRANT ALL ON payment TO service_role;
GRANT SELECT ON payment TO authenticated;
CREATE POLICY payment_select_own ON payment
  FOR SELECT TO authenticated USING (user_id = auth.uid());
