# SCHEMA_NOTES — Phase 1, steps 0–1

Ambiguities in BRIEF.md §5/§6.1 resolved while building the schema + migrations.
The brief wins; where it was silent or self-conflicting, a sane choice was made
and logged here. No tables were invented beyond what the brief implies.

## Table count: 13 (matches the worked-example verify output)

§5 enumerates 12 tables (`badge`/`user_badge` are two). The worked example expects
**13 tables**. The 13th is **`notification`**, defined in **§11**
("Notifications + weekly digest … таблица `notification`"). Included to satisfy
both the brief and the verify count.

Full list: `region, profile, content_item, passage, question, answer_key,
attempt, badge, user_badge, referral, leaderboard_entry, topic, notification`.

## `user` → `profile`, keyed to `auth.users.id`

The deliverable requires `profile.id` = FK to `auth.users.id`. Supabase owns the
`auth.users` table and it can't be extended, so §5's `user` is implemented as a
`public.profile` table whose `id` is both PK and `REFERENCES auth.users(id) ON
DELETE CASCADE` — the standard Supabase pattern. All FKs in §5 that pointed at
`user` (created_by, user_id, inviter_id, etc.) point at `profile`.

For local verification, `auth.users` is emulated by
`scripts/bootstrap-supabase-local.sql` (never part of the app migrations; on real
Supabase the table already exists).

## `question_type` enum includes `short_answer`

§4.2's canonical list has 16 values (incl. `map_labelling`, `form_completion`).
§4.1 lists **Short-answer** as a real Reading *and* Listening question type, but
it's absent from the §4.2 list. Added `short_answer` (17 values) so content import
can't hit an unmapped type later. Harmless if unused.

## `answer_key` lock — defence in depth (§6.1)

The brief mandates `answer_key` be closed by RLS so clients "physically cannot
read it". Implemented with **both** mechanisms:
- RLS enabled, **zero** policies for `anon`/`authenticated` (default deny), and
- `REVOKE ALL ON answer_key FROM anon, authenticated, PUBLIC`.

So an `anon` `SELECT` fails with `permission denied` (SQLSTATE 42501). `service_role`
(grading) retains full access and bypasses RLS, mirroring Supabase. The verify
gate asserts the anon denial.

## RLS on all 13 tables (§6.1)

§6.1 says the browser hits Postgres with the anon key, so every public table is
RLS-protected (not just `answer_key`) with sensible baseline policies:
- public read: `region`, `badge`, `topic`, `leaderboard_entry`;
- published-only read: `content_item`, `passage`, `question`;
- owner-only: `profile`, `attempt`, `user_badge`, `referral`, `notification`;
- `answer_key`: locked (above).
Admin writes and grading run through `service_role` (server-side), which bypasses
RLS. Policies use `auth.uid()` (Supabase-provided; locally stubbed).

## Field-level choices

- **`question_types`**: `text[]` (per §5 literal "text[] канон-enum") with a **GIN
  index** (per §5/§6.1 fast filter), not a Postgres `enum[]` — keeps catalog
  filtering flexible against the canonical labels.
- **`leaderboard_entry.scope`**: §5 says `scope (global | region_id)`. Modeled as
  `text` holding `'global'` or a region id as text, with a surrogate `id` PK and
  `UNIQUE (user_id, period, scope)`. Index `(period, scope, rank)` for fast reads.
- **`content_item.band_scale`**: §5 lists `band_scale (jsonb raw→band)` as a column
  on `content_item`, while §11 mentions "отдельные таблицы raw→band" (separate
  per-band_type tables). Resolved per §5 (the v1 data-model authority): a `jsonb`
  column on the content row — the band scale rides with the test it grades, and
  band is shown only for Full tests (§11). No separate band-scale tables created.
- **Leaderboard anti-cheat (§4.6)**: `leaderboard_entry` has an open
  `USING (true)` read policy (ranks are public). `hidden_from_leaderboard` is NOT
  enforced at the RLS layer — the (Phase 2) precompute job is the gatekeeper and
  must exclude hidden profiles before writing rows. Documented as a job invariant
  rather than baked into the policy (the leaderboard surface is Phase 2).
- **`user_badge`**: composite PK `(user_id, badge_id)`; `earned_at` is a column
  (§5's "earned_at (PK составной)" reads as "composite PK", with earned_at stored).
- **`target_band` / `band_score`**: `numeric(2,1)` (one decimal, 0.0–9.0 band scale).
- **`raw_score`**: `integer` (0–40 correct count).
- **`evidence_ref`** (question): `text` (paragraph ids in source HTML are strings).
- **`referral.reward`**: `text` (type unspecified in §5).
- **`region`**: kept exactly `id, parent_id, name, level` (no extra columns) to stay
  faithful to §5. Seeding the Uzbekistan reference data is a later step (out of
  scope for steps 0–1).
- **`order`** (passage, question): SQL reserved word → quoted `"order"`.
- All PKs are `uuid DEFAULT gen_random_uuid()` (Postgres 13+ core; no extension),
  except `profile.id` which comes from `auth.users`.

## Migrations: custom up/down over Drizzle schema

§11 mandates Drizzle "up/down". Drizzle Kit's `generate` is forward-only, so:
- `src/db/schema.ts` (Drizzle) is the **typed source of truth**;
- `/migrations/<name>/{up,down}.sql` are hand-authored to mirror it and provide
  true reversibility + RLS;
- `scripts/migrate.ts` applies them with `_migrations` bookkeeping (idempotent
  re-runs); `drizzle.config.ts` is wired for future `npm run db:generate`.
Keep schema.ts and the SQL in lockstep when the model evolves.

`auth.users` is referenced via `authUsers` from `drizzle-orm/supabase` so Drizzle
Kit treats it as external (no `CREATE SCHEMA auth`). One residual quirk: a *first*
`db:generate` from an empty snapshot still emits a baseline `CREATE TABLE
"auth"."users"` — ignore/remove it (Supabase provides that table). Incremental
generates afterwards are clean. The `/drizzle` output is gitignored and
reference-only; the executable contract is `/migrations`.

## Auth (step 2): profile auto-provisioning

`migrations/0002_auth` adds a `SECURITY DEFINER` trigger `on_auth_user_created`
on `auth.users` that inserts the matching `public.profile` row on signup (the
standard Supabase pattern — `public.profile` can't be written by the client
before a session exists). `auth_provider` is read from `raw_app_meta_data` and
clamped to the enum (default `email`); `referral_code` is a 10-char slice of a
fresh `gen_random_uuid()` (no extension; collision is astronomically unlikely at
launch scale — can add a retry loop later if needed). The local
`bootstrap-supabase-local.sql` adds the `raw_app_meta_data` / `raw_user_meta_data`
columns the trigger reads (real Supabase `auth.users` already has them). Browser
auth needs `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (same
public values as the server `SUPABASE_URL` / `SUPABASE_ANON_KEY`).

## Phase 2A (migration `0003_phase2_ratings`): rating + leaderboard

Decisions made building the Elo rating + leaderboard (BRIEF §4.6 / §5
`leaderboard_entry`). The brief says only "Elo-style (старт 1000), хранить
`peak_rating`" — Elo needs an opponent, which the brief leaves open; resolved as
below.

- **Test-side Elo (two new `content_item` columns).** `difficulty_rating`
  (`integer NOT NULL DEFAULT 1000`) + `difficulty_count` (`integer NOT NULL
  DEFAULT 0`). Each rated attempt is a "match" between the user and the test:
  `expected = 1/(1+10^((Rtest-Ruser)/400))`, `performance = rawScore/total`
  (∈[0,1]), `userDelta = round(K·(performance-expected))`, `testDelta =
  -userDelta` (zero-sum), `K = 24`, both floored at `100`. The test rating
  self-calibrates so hard tests are worth more. `peak_rating` tracked from the
  floored new rating.
- **Only the first attempt is rated (§4.6).** `rated` is derived in
  `apply-post-submit.ts` by counting the user's `submitted` attempts for the test
  *after* the row is inserted — `count === 1` ⇒ first ⇒ rated; retakes are
  practice-only. (Latent coupling: this re-derivation assumes attempts are
  inserted directly as `submitted`; when autosave/resume lands — `in_progress`
  rows transitioned to `submitted` — switch to a transactional `rated` marker.)
- **Streak / XP** updated on every submit (rated or not): UTC-day compare vs
  `last_activity_date` (same day → unchanged, yesterday → +1, else → reset to 1);
  `longest_streak = max(...)`; `xp += 10 + rawScore`.
- **`leaderboard_entry` is a full rebuild** (`recomputeLeaderboard()`), run after
  each *rated* submit, wrapped so a failure never breaks the submit. Full rebuild
  is fine at launch scale (§6.1 wants precompute, not on-the-fly); incremental /
  Vercel-cron is a later optimization.
  - `all_time` score = `rating`; eligible if `rated_count > 0`.
  - `weekly` / `monthly` score = `SUM(raw_score)` over each test's **first**
    submitted attempt whose first attempt falls in the last 7 / 30 days. Counting
    only the first attempt per `(user, content_item)` is the anti-farm guard —
    replaying a test cannot pad period scores (mirrors first-attempt-only rating).
  - `scope` per user = `'global'` + the user's `region_id` and every ancestor id
    (walk `parent_id` to the country), so one attempt ranks them globally, in
    their viloyat, and country-wide. `hidden_from_leaderboard` profiles are
    excluded here (the precompute is the §4.6 gatekeeper, per the RLS note above).
- **Leaderboard reads go through the Drizzle owner path**, not the anon client:
  `profile` RLS is owner-only, so the anon client can't read *other* users'
  rows. `readLeaderboard()` (server-only) selects ONLY public columns
  (`display_name`, `avatar_url`, `rating`) — never `email` or private fields.
- **Region seed.** `0003` seeds Uzbekistan (`country`) + its 14 first-level
  divisions (`region`): Andijan, Bukhara, Fergana, Jizzakh, Khorezm, Namangan,
  Navoiy, Kashkadarya, Samarkand, Syrdarya, Surkhandarya, Tashkent Region,
  Tashkent City, Karakalpakstan. Idempotent (CTE guarded by `WHERE NOT EXISTS` on
  `name='Uzbekistan'` + per-child name); `down.sql` deletes them and drops the two
  columns. Tuman (district) level deferred (~200 rows, not blocking). Verified:
  the local verify gate applies/reverts `0003` cleanly and the seed yields exactly
  1 country + 14 regions.

**Deferred to the autosave/resume milestone (real §4.6 gaps, not introduced by
2A):** server-trusted timing — `attempt.started_at` is still derived from the
client-supplied `timeUsedSeconds`, so the "too-fast → flag" check has no integrity
until an `in_progress` row is stamped server-side at exam start; and submit
rate-limit + `(user, test)` idempotency. The leaderboard-farming vector those would
open is already closed by the first-attempt-only period scoring above.

## Phase 2B (migration `0004_seed_badges`): badges

Badge achievements (BRIEF §4.7; `badge`/`user_badge`; §11 `notification`). No
schema change — those tables already existed.

- **`badge.criteria` jsonb is a discriminated union on `type`**, shared verbatim
  between the seed and the engine (`src/lib/progress/badges.ts`):
  `{volume,tests}` · `{streak,days}` · `{rating,min}` · `{perfect}` ·
  `{accuracy,qtype,minQuestions,minPct}` · `{first_place,scope,period}`. Unknown
  `type` ⇒ never awarded. `0004` seeds 12 badges (first_test, tests_10/50,
  streak_3/7/30, perfect, rating_1200/1500, tfng_sniper, completion_pro, champion),
  idempotent via `ON CONFLICT (code) DO NOTHING`; `down.sql` deletes them (the
  `user_badge` FK is `ON DELETE CASCADE`). Icons are emoji (no icon-asset system
  yet). `first_place` is only computed for `global`/`all_time` rank 1 (champion).
- **`evaluateBadges(userId)`** runs in `applyPostSubmit` AFTER the streak/rating
  write and leaderboard recompute (so streak, rating, and first_place are current).
  Best-effort (never throws). Stats computed once from the owner path: volume =
  count of submitted attempts; `perfect` = an attempt whose `rawScore` equals the
  summed `per_type_breakdown[*].total` (>0); per-qtype accuracy summed across
  attempts; first_place from `leaderboard_entry`.
- **Idempotency / no double-award, no double-notify.** Only not-yet-earned badges
  are evaluated; `user_badge` insert is `onConflictDoNothing().returning()`, and
  notifications + the returned "awarded" set are derived ONLY from the rows that
  insert actually wrote — so a losing concurrent submit notifies nothing
  (`notification` has no unique constraint to lean on).
- **Unlock celebration is passed by value, not inferred by time.** `applyPostSubmit`
  returns `awardedBadges`; the submit action puts their codes on the result
  redirect (`?…&unlocked=code1,code2`); the result page renders `BadgeUnlock`
  (client, `@keyframes badge-pop`, `prefers-reduced-motion` guarded) from those
  codes. This avoids the earlier `earned_at >= submitted_at` query's cross-attempt
  misattribution and app/DB clock-skew, and shows the celebration exactly once
  (absent on revisits). `/app/badges` is the persistent showcase (earned vs locked),
  read via the anon client (badge public + own `user_badge`, RLS + explicit
  `user_id` filter).

## Phase 2C (migration `0005_referral_linking`): referral linking

Invite-a-friend (BRIEF §4.9 / §11). No schema change — `referral` and
`profile.referred_by` already exist from `0000`; `0005` is **trigger-function
only** (`CREATE OR REPLACE FUNCTION public.handle_new_user`, the `0002`
`on_auth_user_created` binding is untouched).

- **Two distinct codes.** The *shared* invite code is `profile.referral_code`
  (the 10-char code from `0002`); the link is `/auth?ref=<referral_code>`. The
  *per-referral* `referral.code` is a **fresh, independent** 12-char
  `gen_random_uuid()` slice (UNIQUE), generated per row — it is NOT the shared
  code, it just satisfies the `referral.code` UNIQUE column.
- **ref_code flows through auth metadata.** `signUp` puts it under
  `options.data.ref_code` → `NEW.raw_user_meta_data ->> 'ref_code'` (NOT
  `raw_app_meta_data`, which holds the provider). The trigger looks up
  `profile.referral_code = v_ref`, sets `referred_by`, and inserts ONE referral
  row (`status='registered'`). Invalid / empty / whitespace codes leave
  `referred_by` NULL and create no row; replay is idempotent
  (`WHERE NOT EXISTS (… invitee_id = NEW.id)`).
- **Self-referral.** Same-id self-referral is blocked (`IF v_inviter = NEW.id
  THEN v_inviter := NULL`). It is essentially unreachable on a real first signup
  (the new user has no `referral_code` yet) — the guard is defensive against a
  replayed trigger. **Multi-account farming** (user A invites their own burner B,
  completes one cheap submit on B) is **NOT** defended by `0005` and is a known,
  accepted gap: the real §11 control (Turnstile/captcha + email-confirm on signup,
  plus a per-inviter velocity cap) is a separate anti-bot milestone, absent from
  the codebase today. `app/auth/actions.ts` passes no `captchaToken` yet.
- **Referral insert is EXCEPTION-guarded.** A `BEGIN … EXCEPTION WHEN OTHERS THEN
  RAISE WARNING … END` wraps ONLY the `referral` INSERT (added after the 2C review)
  so a non-essential perk can never abort signup — e.g. an (astronomically rare)
  `referral.code` collision degrades to a warning. The `profile` INSERT stays
  unguarded on purpose: a user without a profile row IS broken and SHOULD abort.
- **Reward = atomic claim + grants in ONE transaction.** `maybeRewardReferral`
  (`src/lib/progress/referral.ts`) runs from `applyPostSubmit` after the invitee's
  submit. The single-fire claim `UPDATE referral SET status='rewarded' WHERE
  invitee_id=? AND status='registered' RETURNING` and BOTH XP grants (inviter
  +100, invitee +50, via SQL `xp = xp + n` increments) run inside
  `db.transaction(...)` — so the status flip and the XP can never diverge (a crash
  between them would otherwise leave `rewarded` with no XP, unrecoverable because
  the single-fire guard blocks any retry; fixed after the 2C review). The two
  `notification` inserts stay OUTSIDE the transaction (best-effort, each own
  try/catch); `notification.type` has no referral value so `'system'` is used.
- **Reward fires after `>=1` submitted test — literally.** `applyPostSubmit` runs
  on every submit after the attempt is `status='submitted'`, so the reward can't
  fire on an `in_progress` / no-attempt path. The contract bar is "a submit
  occurred", not "a scored/meaningful test" — a 0-correct throwaway submit
  qualifies. Adding a `rawScore > 0` / `rated` floor is a deferred product choice,
  not a 2C contract requirement.
- **Migration lockstep.** `0005 down` restores the `0002` function body verbatim
  (no `ref` handling); it does NOT drop/recreate the trigger (both up and down are
  `CREATE OR REPLACE FUNCTION` only, so the `0002` trigger binding survives a
  clean up→down→up round-trip). `down` leaves historical `referred_by` links and
  `referral` rows intact (user data owned by `0000`, not `0005`). `src/db/schema.ts`
  is unchanged (no table/column/enum drift). Verified: the local verify gate
  applies/reverts the full chain cleanly.
- **Verification.** The verify gate's auth-trigger check only exercises the
  *no-ref* path; the *with-ref_code* path (valid link, fresh unique per-row code ≠
  shared, invalid/blank code ignored, single-fire claim, no self-loop) was proven
  on local docker by a throwaway script and Supabase had its live
  `handle_new_user` body confirmed read-only (then both deleted). The verify gate's
  health check was also made cross-platform (launch Next via `node
  next/dist/bin/next` instead of the extensionless `.bin/next` shim, which ENOENTs
  on Windows / Node ≥20).

## Phase 2D (migration `0006_payments`): tiers + payment

Tier gating (BRIEF §4.8) + the subscription/payment lifecycle (§11). Adds the
**14th app table `payment`** — §5 lists 13, but §4.8 (payment) + §11 (webhook →
`premium_until`; cron downgrade) need a durable, idempotent record of each charge.
`verify`'s `APP_TABLE_COUNT` bumped 13→14 accordingly. New enums `payment_provider`
(`payme|click|uzum`) + `payment_status` (`pending|completed|failed`); `payment`
reuses `user_tier` for the purchased tier. RLS: owner-`SELECT` only; all writes go
through the server-privileged path (Drizzle owner / `service_role`). Idempotency key
= `UNIQUE(provider, provider_transaction_id)`.

- **`src/lib/tiers.ts` is the single gating rule.** `effectiveTier({tier,
  premium_until})` demotes an expired premium/ultra to `basic` (the cron downgrade
  may lag, so gates never trust a stale stored tier); `meetsTier` (basic<premium<
  ultra); `hasFullReview` (premium+); `BASIC_DAILY_LIMIT=3` (§4.8 placeholder `N`).
  Every gate uses `effectiveTier`, never the raw column.
- **Gating points (defense-in-depth).** Catalog (`reading/page.tsx`) shows a lock
  pill + routes locked tests to `/app/upgrade` (doesn't hide them). Exam start
  (`reading/[id]/page.tsx`) redirects on tier mismatch. **The submit server action
  (`reading/[id]/actions.ts`) re-checks the tier gate independently** (page gating
  alone is bypassable by POSTing the action) AND enforces the Basic daily limit
  (count of today's `submitted` attempts, UTC day). Result (`result/page.tsx`)
  gates the full review by `hasFullReview`: a Basic user gets score+percent only and
  the breakdown/explanation/evidence are NOT rendered — they never enter the client
  React tree (server-side branch, not CSS hiding), so `answer_key`/evidence never
  reach a Basic browser.
- **Payment seam (`src/lib/payments/`), keys-optional (§10).** `paymentSecret(p)`
  returns null until a merchant key is set. `verifyWebhook`: in **stub mode** (no
  key) it skips signature verification — but only OUTSIDE production; in production a
  missing key **fails closed** (a deployed stub must not mint tiers). The real-key
  path is an HMAC-SHA256 **placeholder** — each UZ provider has its own scheme
  (Payme Basic-auth, Click md5, Uzum HMAC), wired at onboarding. `PLANS` + `findPlan`
  hold server-side prices (tiyin); the client never dictates an amount.
- **Lifecycle.** `initiatePayment` (server action) creates a `pending` row ONLY
  (server-trusted price + the session `userId`) and redirects to a stub checkout —
  it grants nothing. The webhook (`/api/webhooks/[provider]`) is the ONLY path that
  extends `premium_until` / sets `tier`. `applyCompletedPayment` is idempotent +
  single-fire + best-effort: in ONE `db.transaction` it looks up the pending row by
  `(provider, providerTransactionId)`, validates `(tier, periodMonths, amount)`
  against `findPlan`, then `UPDATE … WHERE status<>'completed' RETURNING` (the
  single-fire claim) + extends `premium_until = greatest(now(), premium_until) + N
  months` + sets `tier`. Cron (`/api/cron/expire-premium`, Vercel `vercel.json`
  `0 3 * * *`) downgrades profiles whose `premium_until` passed (NULL untouched);
  authenticated by `Bearer CRON_SECRET`, **fail-closed** when the secret is unset.
- **Adversarial review (3 lenses) drove these fixes — the critical one:** the
  webhook originally trusted `userId/tier/periodMonths/amount` from the POST body, so
  in stub mode anyone could `POST /api/webhooks/payme {tier:'ultra',…}` and self-
  grant (or target another user's) Ultra for free. **Fix:** the webhook body now
  carries ONLY `providerTransactionId`; all entitlement is derived from the trusted
  pending row, rejecting unknown tx ids. Plus: `findPlan` amount/tier coherence
  (blocks an unsold/partial-amount grant even after real signing); the production
  fail-closed stub guard; the middleware exclusion anchored to `api/webhooks/` /
  `api/cron/` (was a loose prefix matching `api/webhooksXYZ`); and the cron Bearer
  compared with `timingSafeEqual`. The unused `requireTier` helper was removed (the
  live gates are inline).
- **Known accepted gaps (documented, not fixed):** (1) the Basic daily-limit
  count→insert is a non-transactional TOCTOU — §4.8 treats it as a soft monetization
  nudge, not a security boundary (the window is UTC-based and retakes are free by
  design), so it's left best-effort. (2) The HMAC verification is a placeholder until
  each provider's real signature scheme + merchant keys land (§10). (3) The same §11
  anti-bot controls noted for 2C (Turnstile/captcha, rate-limit) remain a separate
  milestone.
- **Verification.** `verify` gate green (14 tables, `payment` RLS owner-read,
  up→down→up clean). The webhook lifecycle was proven E2E on local docker by a
  throwaway script (valid pending → applied + upgrade; replay → duplicate, no double
  extend; **forged tx with attacker payload → rejected, no grant, victim untouched**;
  amount≠plan → failed, no grant), then deleted. `0006` applied to Supabase.

## 0007 — one in_progress attempt per (user, test)

Anti-cheat / integrity (BRIEF §4.6). `ensureAttempt` resumes an existing
in_progress attempt via a check-then-insert, but the gap between the resume
SELECT and the INSERT let two concurrent first-starts (double-click / two tabs /
retry) each miss the resume and both INSERT — two in_progress rows for one
(user, content_item), and a doubled `test_start` funnel event (§11; surfaced by
the telemetry review).

- **Schema (lockstep):** partial unique index `attempt_one_in_progress_idx ON
  attempt (user_id, content_item_id) WHERE status = 'in_progress'` (schema.ts
  `uniqueIndex(...).where(...)` + migration `0007`). `up` first collapses any
  pre-existing duplicate in_progress rows (keep the most recent per pair) so the
  index can't fail to build on legacy data; `down` only drops the index (the
  dedup is a one-way data repair, not restored).
- **App:** `ensureAttempt` inserts with `ON CONFLICT (user_id, content_item_id)
  WHERE status='in_progress' DO NOTHING`. Empty `returning` => lost the race =>
  resume the winner's row and do NOT fire `test_start`. Exactly one row + one
  event per real start.
- **Verification.** `verify` gate green (up→down→up idempotent, index builds +
  drops). Behavioral invariant proven on local docker by a throwaway script
  (2nd in_progress via ON CONFLICT inserts nothing; plain 2nd raises a unique
  violation; a fresh in_progress is allowed once the prior one is submitted),
  then deleted. Applied to Supabase (verified in `_migrations` + `attempt_one_in_progress_idx` present on the live DB).
