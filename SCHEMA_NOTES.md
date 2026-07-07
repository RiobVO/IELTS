# SCHEMA_NOTES — Phase 1, steps 0–1

Ambiguities in BRIEF.md §5/§6.1 resolved while building the schema + migrations.
The brief wins; where it was silent or self-conflicting, a sane choice was made
and logged here. No tables were invented beyond what the brief implies.

## Table count: 34 (Phase 1 shipped 13; +21 added in later phases)

§5 enumerates 12 tables (`badge`/`user_badge` are two). The Phase-1 worked example
expected **13 tables** — the 13th is **`notification`**, defined in **§11**
("Notifications + weekly digest … таблица `notification`").

Phase-1 list (13): `region, profile, content_item, passage, question, answer_key,
attempt, badge, user_badge, referral, leaderboard_entry, topic, notification`.

**Post-Phase additions (+18 → 31, in lockstep with `verify.ts` `APP_TABLE_COUNT = 31`):**
- `payment` — migration `0006_payments` (Phase 2D: tiers + payment lifecycle).
- `annotation` — migration `0013_annotation` (reader highlights/notes, W2-1).
- `leaderboard_snapshot` — migration `0014_leaderboard_snapshot` (rank-movement deltas).
- `attempt_review_snapshot` — migration `0021_attempt_review_snapshot` (D3: stable
  post-submit review; SERVER-ONLY, locked like `answer_key`).
- `signup_throttle` — migration `0022_signup_throttle` (signup velocity-cap by IP
  hash; SERVER-ONLY).
- `writing_task`, `writing_submission`, `writing_feedback`, `writing_feedback_debug`
  — migration `0023_writing_lab` (Phase 3 Writing Lab: AI essay evaluation; the
  debug table is SERVER-ONLY, locked like `answer_key`). See the Phase 3 Writing
  section below.
- `speaking_task`, `speaking_submission`, `speaking_feedback`, `speaking_feedback_debug`,
  `speaking_audio_event` — migration `0027_speaking_lab` (Phase 3 Speaking Lab, Part 2:
  audio evaluation; `speaking_feedback_debug` SERVER-ONLY, locked like `answer_key`;
  `speaking_audio_event` = biometric audit trail).
- `error_log` — migration `0034_error_log` (self-hosted error monitoring; SERVER-ONLY,
  RLS + grants revoked like `signup_throttle`; written by `logError()` — client-error
  endpoint + explicit server catch, read owner-path by `/admin/errors`).
- `vocab_deck`, `vocab_card`, `vocab_progress` — migration `0037_vocab` (Vocabulary
  feature: spaced-repetition flashcards). Deck/card are published-gated content (like
  `content_item`/`passage`); `vocab_progress` is a per-user SM-2 SRS state, owner-read
  with server-only writes. See the "0037 — Vocabulary" section below.
- `mistake_resolution` — migration `0040_mistake_resolution` (P9-rich «вариант B»:
  per-user "mistake resolved" records). Open mistakes are NOT materialized — they are
  derived at read-time from `attempt_review_snapshot` + `attempt.answers` via `gradeOne`,
  so `submitAttempt`/grading/rating are untouched. Owner-read + server-only writes like
  `vocab_progress`. See the "0040" section below.
- `saved_word` — migration `0041_saved_word` (P11 «Saved words»: personal word bank,
  Practice wave C). A word bookmarked from a reading passage (practice only) + its
  context sentence + source content_item, with its OWN SM-2 state (same `reviewCard`
  core as `vocab_progress`). LLM-free / no external dictionaries — no auto-definitions,
  `vocab_card` is never synthesized. Owner-read (RLS `user_id = auth.uid()`) + server-only
  writes (owner-path `saveWord`/`reviewSavedWord`/`deleteSavedWord`), exactly like
  `vocab_progress`/`mistake_resolution`. Unique on `(user_id, lower(word))` (expression →
  unique INDEX). Vocab is OUTSIDE the rating/leaderboard loop; this table too.
- `mistake_review` — migration `0044_mistake_review` (учебная петля, BRIEF §12.3 шаг 2,
  SR-волна). SM-2-расписание повторов (same `reviewCard` core as `vocab_progress`/
  `saved_word`) for open mistakes — a per-`(user, content_item, question_number)` due-date
  state sitting ON TOP of `mistake_resolution` (0040), which still owns the terminal
  "resolved" fact. Open mistakes stay derived at read-time; this table only attaches a
  `due_at`/`ease`/`repetitions` schedule so the queue can prioritize what's due. Owner-read
  (RLS `user_id = auth.uid()`) + server-only writes (owner-path `reviewMistake` in
  `app/app/reading/[id]/practice-actions.ts` — gated by `loadPracticeKey`, grades on the
  server, UPSERTs the SM-2 state, and best-effort auto-resolves at `repetitions >= 3`),
  exactly like `saved_word`/`mistake_resolution`. `verify.ts` covers it in full now: added to
  the owner-read cohort (§4i loop: RLS on + anon SELECT denied) and a `mistake_review`
  `INSERT`-denied case in `clientWriteLockdown` (§6), mirroring `saved_word`.

The DB has **34** tables. `verify.ts` `APP_TABLE_COUNT` must track it — bump **33 → 34**
for `0044` (`mistake_review`; count-only this round, see above). `src/db/schema.ts` types
**33** of them: the legacy `topic` table (migration `0000`, Phase 1)
is unused since Phase 3 moved to `writing_task`/`speaking_task`, so its Drizzle export +
`topic_skill` enum were dropped as dead code (#26) while the empty table lingers in the DB
(no destructive drop). Re-add a typed export only if `topic` is ever revived.

## `user` → `profile`, keyed to `auth.users.id`

The deliverable requires `profile.id` = FK to `auth.users.id`. Supabase owns the
`auth.users` table and it can't be extended, so §5's `user` is implemented as a
`public.profile` table whose `id` is both PK and `REFERENCES auth.users(id) ON
DELETE CASCADE` — the standard Supabase pattern. All FKs in §5 that pointed at
`user` (created_by, user_id, inviter_id, etc.) point at `profile`.

For local verification, `auth.users` is emulated by
`scripts/bootstrap-supabase-local.sql` (never part of the app migrations; on real
Supabase the table already exists).

**`profile.weekly_digest_opt_out`** — migration `0042_email_opt_out` (BRIEF §11/§12.1
step 2: email provider -> verify -> weekly digest). Plain boolean, DEFAULT false
(opted in). No new grants/policies: the column inherits `profile`'s existing RLS
posture (owner-only); written only by the owner-path unsubscribe server route, same
as every other per-user profile field.

**`notification_weekly_digest_week_uidx`** — migration `0043_notification_digest_ledger_uidx`.
Partial UNIQUE index `(user_id, (data->>'week')) WHERE type = 'weekly_digest'`: the ledger
that makes the weekly-digest job's per-user claim atomic (`INSERT ... ON CONFLICT DO NOTHING`
on the ISO-week key), closing the TOCTOU between concurrent cron + manual runs. No new
grants/policies — it inherits `notification`'s owner-only posture; other notification types
stay unconstrained. Prod had no `weekly_digest` rows yet, so it builds cleanly.

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

## Audit closure (2026-06-25): migrations 0018–0022

Schema changes from the CLAUDE_AUDIT.md closure batch (findings detail there):
- **0018 `auth_provider` += `google`** — Google is a launch OAuth provider; the enum
  + the `handle_new_user` clamp now store `google` instead of collapsing it to
  `email`. `ALTER TYPE ADD VALUE` is irreversible on prod, so the `down` recreates
  the enum (folding any `google` row → `email`).
- **0019 `content_item.reviewed_at` + `import_warnings`** — admin import review gate:
  a draft can't be published until `reviewed_at` is set (`markReviewed`), and
  `setStatus('published')` re-checks it server-side; `import_warnings` (jsonb) holds
  parser low-confidence notes for the review screen. (Re)import resets `reviewed_at`
  (the row is replaced).
- **0020 `payment.expires_at`** — pending-checkout TTL (`PENDING_TTL_MS`); the webhook
  rejects an expired pending (`expired` → `failed`, no access). The completed-replay
  idempotency check runs **before** the expiry check, so an applied payment stays
  idempotent past its TTL. TTL is a placeholder until provider onboarding.
- **0021 `attempt_review_snapshot`** — D3 stable review; SERVER-ONLY, locked like
  `answer_key` (RLS on, grants revoked). Holds correct answers + explanation/evidence
  captured at submit; `/result` reads it owner-path (fallback to the live key for
  legacy attempts). A client read would bypass the answer_key lock **and** the tier
  gate — `verify` asserts the anon denial (mirror of the `answer_key` assertion).
- **0022 `signup_throttle`** — signup velocity-cap; SERVER-ONLY, RLS + grants revoked.
  Stores `sha256(ip)` (not PII), one row per signup attempt; `signUp` caps sign-ups
  per IP per hour (`SIGNUP_THROTTLE_*`) over the fail-open captcha.

## RLS on all tables (§6.1)

§6.1 says the browser hits Postgres with the anon key, so every public table is
RLS-protected (not just `answer_key`). Phase-1 baseline policies (the then-13
tables; later tables carry their own RLS in their migrations — see Phase 2D
`payment`, `0013_annotation`, `0014_leaderboard_snapshot`):
- public read (anon): `region`, `badge`, `topic`;
- authenticated-only read: `leaderboard_entry` (was anon-public; locked to `authenticated`
  by migration `0033`, #18 — the app reads it owner-path, so anon lost nothing);
- published-only read: `content_item`, `passage`, `question`. For `content_item`
  the SELECT grant is **column-level** since `0035` (N1/N9, AUDIT_2026-07-02):
  `runner_html` + service columns (`source_file_path`, `import_warnings`,
  `reviewed_at`, `created_by`) are revoked from anon/authenticated — every app
  read of those goes owner-path (Drizzle); new columns are born unreadable until
  granted explicitly. Asserted by `npm run verify` (columnLock);
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
- **Leaderboard anti-cheat (§4.6)**: `leaderboard_entry` read policy is
  `USING (true)` but scoped **`TO authenticated`** (migration `0033`, #18 — was
  `TO anon, authenticated`; anon exposed uuid+rating via REST, and the app reads it
  owner-path so anon access was pure attack surface). `hidden_from_leaderboard` is NOT
  enforced at the RLS layer — the precompute job is the gatekeeper and must exclude
  hidden profiles before writing rows. `verify` asserts anon SELECT is now denied.
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
  ultra); `hasFullReview` (premium+); `BASIC_DAILY_LIMIT=25` (§4.8 placeholder `N`,
  set high at launch — no monetization yet, effectively unlimited for a real
  student — tighten it as an upsell when paid tiers go live). Every gate uses
  `effectiveTier`, never the raw column.
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

## Phase 3 Writing (migration `0023_writing_lab`): AI essay evaluation tables

Phase 3 unfreeze, **Writing only** (BRIEF §4.10 — was FROZEN). Four **additive**
tables for the AI Writing Lab (IELTS Task 2 essay, Academic + General one format).
Core Reading/Listening grading/import stays deterministic + LLM-free (§4.2) — zero
contact with R/L `answer_key`/grading. Bumps the app table count **18 → 22**
(`verify.ts` `APP_TABLE_COUNT = 22`). New enums: `writing_category`
(`academic|general`), `writing_task_status` (`draft|published`),
`writing_submission_status` (`pending|evaluating|completed|failed`),
`writing_confidence` (`low|medium|high`).

- **`writing_task`** — admin-authored essay prompt. Published-gated like
  `content_item` (RLS `SELECT` to `authenticated USING (status='published')`);
  drafts read owner-path only. `tier_required` defaults to `ultra` (AI = Ultra,
  §4.8). **Not a reuse of the `topic` stub:** `topic` is too thin and its skill
  generality would mix writing/speaking semantics (Speaking structures by Part
  1/2/3, not academic/general), so a dedicated table — the `topic` stub is left
  untouched for the Speaking phase.
- **`writing_submission`** — a user's essay attempt. Owner-read like `annotation`
  (`SELECT` own rows; **no insert/update grant** — writes go owner-path). The
  `status` lifecycle drives the async evaluator; `updated_at` feeds the reaper (a
  row stuck in `evaluating` past a threshold → `failed`).
- **`writing_feedback`** — the user-visible analysis snapshot (band range +
  confidence + per-criterion + top fixes + annotations + rewrite + checklist +
  `provider`/`model`/`prompt_version`). Owner-read **through** the submission
  (EXISTS join, like `passage`→`content_item`), one row per submission
  (`submission_id UNIQUE`). Holds **no** raw model output.
- **`writing_feedback_debug`** — raw model output for calibration/debugging.
  **HARD-LOCKED like `answer_key`**: RLS on, **no** anon/authenticated policy,
  `REVOKE ALL FROM anon, authenticated, PUBLIC`; only `service_role` / owner-path
  reads it. Raw may carry prompt-leakage / model reasoning, so it never reaches the
  client.

RLS posture mirrors existing tables exactly; `writing_task`/`writing_submission`/
`writing_feedback` grant `authenticated` **only `SELECT`** (all writes server-side,
like `annotation`/`payment`), so a client cannot insert/update a submission status
or forge feedback. `schema.ts` kept in lockstep. **Data foundation only** — the
evaluator, internal `/api/writing/evaluate` route, server actions, admin form, and
`/app/writing` UI land in later Writing plans.

**Verification.** `verify` gate green on local docker (22 tables; up→down→up clean
+ idempotent; per-table RLS proven by catalog probe — `writing_feedback_debug` RLS
on with zero anon/authenticated grants + no policy; the other three `SELECT`-only
for `authenticated`). **Supabase application pending** — additive with no readers
until the evaluator ships, so it can land before Plan 2 (the evaluator) without a
deploy-window break.

## Phase 3 Writing — evaluator + benchmark (Plan 2)

The essay evaluator engine — no DB writes, no route, no UI (those are Plan 3). All
new code lives under `src/lib/writing/evaluator/` + `scripts/`; `@google/genai` and
`zod` are imported **only** in the writing layer, so the R/L core stays LLM-free.

- **Provider seam.** One thin `Evaluator.evaluate(input)` interface (`types.ts`), a
  single Gemini adapter (`gemini.ts`, `ai.models.generateContent` with
  `config.responseMimeType:'application/json'` + `responseSchema`), and a
  `getEvaluator()` factory (`index.ts`). MVP = one provider, no fallback; a second
  provider later changes only the factory, never callers (spec "Evaluator: provider").
- **Zod is the single contract.** `FeedbackSchema` both derives Gemini's
  `responseSchema` (`z.toJSONSchema`, zod v4 — emits `minItems`/`maxItems`/`enum`/
  `minimum`/`maximum`) AND validates `response.text` (`FeedbackSchema.parse` throws on
  schema-invalid / non-JSON → caller maps to a failed submission). The derived JSON
  Schema is accepted by the SDK at the type level (`responseSchema: SchemaUnion =
  Schema | unknown`); live Gemini OpenAPI-subset fit (it ignores `$schema`/
  `additionalProperties`) is proven on the benchmark run, not assumed — if a construct
  is rejected, hand-author the JSON Schema and keep Zod for validation only.
- **Env seam (optional, fail-off).** `writingEvalConfig()` (`src/env.ts`) returns the
  `{apiKey, model}` pair only when BOTH `GEMINI_API_KEY` + `WRITING_EVAL_MODEL` are
  set, else `null` — the app boots without them and Writing Lab is simply disabled
  (mirrors the Turnstile/PostHog fail-open seams; same getter style, not a zod env).

### Calibration set + ops-gate (blocks product enable, NOT this plan)

`scripts/benchmark-writing.ts` runs the evaluator over a human-labeled calibration
set and reports schema-validity + band-accuracy (±0.5). Pure metrics
(`bandMid`/`withinHalfBand`/`accuracy`) are unit-tested; the runner is lazy
(`getEvaluator` + dotenv imported dynamically inside `main()`, after env loads — the
"Scripts gotcha" discipline) and invoked manually only at the ops-gate.

- **Calibration-set shape:** `{ taskPrompt: string; essay: string; category:
  "academic"|"general"; trueBand: number }[]`, path passed as argv — **never
  committed** (copyright: expert-graded own essays; Cambridge official samples are an
  external sanity reference with legal access only, never a repo fixture).
- **`WRITING_EVAL_MODEL` is filled only after** a Gemini Flash candidate passes the
  ±0.5 band-accuracy gate on that set (an INTERNAL model-selection metric, not a
  user-facing promise — UX always shows range + confidence). Until then the var stays
  blank and **Writing Lab stays disabled in product**. Tests are fully mocked
  (`vi.mock("@google/genai")`), so this plan is unblocked by the missing set.

## 0033 — leaderboard_entry locked to authenticated (audit #18)

`leaderboard_entry` was readable by `anon` via the Supabase REST endpoint
(`/rest/v1/leaderboard_entry?select=*`), exposing `user_id` (uuid) + `rating` of every
non-hidden profile. The app never used that path — every leaderboard read is owner-path
(Drizzle, RLS-bypassing) under `requireUser` (`leaderboard/page.tsx`, `app/page.tsx`,
`profile/page.tsx`, the recompute/snapshot jobs) — so anon was pure attack surface. `0033`
drops + recreates the policy as `FOR SELECT TO authenticated USING (true)` and `REVOKE
SELECT … FROM anon` (Postgres can't `ALTER` a policy's role list). `authenticated` keeps its
grant (leaderboard stays visible to logged-in users by design); `hidden_from_leaderboard`
is still enforced by the precompute job. `verify` gained a positive assertion — anon SELECT
on `leaderboard_entry` denied (RLS on + anon denied; not a full lock, an authenticated policy
exists by design). Applied to Supabase; prod REST probe returns 401/42501.

## 0034 — error_log: self-hosted error monitoring (§11)

Own error sink so prod errors are visible in-app without an external service (Sentry stays
an optional no-op, one DSN away). **Additive** table `error_log` (bumps `APP_TABLE_COUNT`
27 → 28). SERVER-ONLY, hard-locked like `signup_throttle`: RLS on, `REVOKE ALL FROM anon,
authenticated, PUBLIC`, no client policy — stack traces + urls may carry internal detail
(`verify` asserts anon SELECT denied). Columns: `source` (`server|client`), `message`,
`stack`, `url`, `user_id` (nullable, `ON DELETE SET NULL` — client crashes may be pre-auth),
`context` (jsonb), `created_at` (indexed for the admin list).

- **`logError()`** (`src/lib/monitoring/log-error.ts`) writes a structured `console.error`
  (→ Vercel Runtime Logs, always) **and** an `error_log` row; it never throws or recurses
  (a failed DB write just logs to console) and strips the URL query (ref/OAuth code) + caps
  field lengths. Called from **nodejs code paths only**.
- **Client crashes** → `app/global-error.tsx` POSTs to `/api/monitoring/client-error`
  (body cap + a global rate-limit backstop so the public endpoint can't bloat the table),
  which persists them. This closes the real gap: client errors were invisible without a
  Sentry DSN.
- **`instrumentation.onRequestError` stays Sentry-only.** That module also bundles for the
  **edge** runtime (no `net`), so importing `@/db` (postgres) there via `logError` 500'd the
  whole app — caught by the `verify` health check. Server errors still land in Vercel logs;
  `logError` is invoked from route handlers / server actions where a durable record is wanted.
- **`/admin/errors`** — owner-only (`requireAdmin`) view of the latest server+client errors.

Applied to Supabase (additive, applied before the code push to avoid a deploy-window break);
prod REST probe on `error_log` returns 401/42501.

## Anti-bot: signup honeypot (no external dependency)

Complements the fail-open Turnstile seam + the per-IP signup velocity cap (`0022`) with a
zero-dependency honeypot — no schema change. The signup form (`AuthScreen.tsx`) carries a
hidden decoy field (`name="website"`, offscreen — NOT `display:none`, which some bots skip —
plus `aria-hidden` + `tabIndex=-1` + no label, so screen readers and Tab navigation never
touch it). `signUp` (`app/auth/actions.ts`) checks it via the pure `isHoneypotTripped()`
(`anti-cheat.ts`): non-empty ⇒ a bot ⇒ silently fake success (redirect to the same
"confirmation sent" message, no account created, DB untouched, trap not revealed). Runs
first — cheaper than the Turnstile/throttle checks and works with zero keys, so Turnstile is
now optional rather than the only signup defense.

## 0037 — Vocabulary (vocab_deck / vocab_card / vocab_progress)

Feature Vocabulary (spaced-repetition flashcards; product plan 2026-07-06). Three
**additive** tables — the R/L/W/S core is untouched. Bumps the app table count
**28 → 31** (`verify.ts` `APP_TABLE_COUNT = 31`). **No new enums:** `status` reuses
`content_status` (`draft|published`) and `tier_required` reuses `user_tier`.

- **`vocab_deck`** — a word set (content). Purpose: the catalog unit a user studies.
  Provenance: Vocabulary plan (2026-07-06). Published-gated **like `content_item`**
  (RLS `SELECT TO authenticated USING (status='published')`; drafts read owner-path
  only). `source_file_path` is **NOT NULL UNIQUE** — the DB-level idempotency key for
  (re)import (mirrors `content_item.source_file_path`, but pinned UNIQUE here so a
  re-import upserts the deck by path instead of relying on app-level dedup).
  `word_count` is a denormalized catalog counter (recomputed on (re)import). RLS
  posture: `REVOKE ALL FROM anon, authenticated, PUBLIC` then `GRANT SELECT TO
  authenticated` + `GRANT ALL TO service_role` — secure-by-default like `0035`, since
  on prod Supabase hands new tables broad default-privilege grants that a bare
  published policy would leave open to anon.
- **`vocab_card`** — a word in a deck (content). Provenance: same plan. Visible only
  when its deck is published — RLS mirrors **`passage`→`content_item`** (EXISTS join on
  `vocab_deck.status='published'`). **`UNIQUE(deck_id, word)`** is the foundation of the
  idempotent upsert re-import (a word is unique within its deck). Ordered by `"order"`
  (quoted reserved word, like `passage`/`question`); index `(deck_id, "order")` serves
  both ordered reads and the FK/cascade (leftmost `deck_id`). Same secure-by-default
  grants as `vocab_deck`.
  - **Why `vocab_card` has NO answer_key-style lock:** these are self-graded
    flashcards. In the MVP a card carries no *hidden* correct answer to protect —
    `definition`/`translation` are the study material the user is meant to see once the
    deck is published (unlike `answer_key`, whose leak would let a client pre-grade a
    scored test). So the card is a normal published-read content row; no lock table,
    no column-grant carve-out.
- **`vocab_progress`** — per-user SM-2 SRS state (`ease`/`interval_days`/`repetitions`/
  `lapses`/`due_at`/`last_reviewed_at`). Provenance: same plan. **Owner-read** (RLS
  `SELECT TO authenticated USING (user_id = auth.uid())`), `UNIQUE(user_id, card_id)`;
  index `(user_id, due_at)` is the due-queue, and a dedicated `(card_id)` FK index keeps
  the cascade-delete fast when a re-import replaces cards.
  - **Why `vocab_progress` is written ONLY owner-path (no client write policy):** the
    SM-2 scheduler and the daily review cap are authoritative server logic. If the
    client could `INSERT`/`UPDATE` its own progress it could forge review state or
    bypass the cap — exactly the `attempt` score-forgery vector. So there is **no**
    `INSERT`/`UPDATE`/`DELETE` policy and `REVOKE ALL FROM anon, authenticated, PUBLIC`
    strips the default-priv grants; only `SELECT` is re-granted to `authenticated`
    (scoped to own rows) and writes go through the Drizzle owner path. `verify` asserts
    this: `vocab_progress` joins the owner-read RLS cohort (RLS on + anon denied) **and**
    the write-lockdown check proves an `authenticated` `INSERT` is denied at the grant
    layer (42501), mirroring the `attempt` forge assertion.

**Verification.** `verify` gate green on local docker (31 tables; up→down→up clean +
idempotent; `vocab_progress` RLS on + anon denied + authenticated INSERT denied).
Supabase application follows the plan's deploy sequencing.

## 0038 — Vocabulary enrichment (additive columns on vocab_card / vocab_deck)

Additive column-only migration (product plan V7/V9/V10 — richer cards + an optional
quiz mode). **No new tables, no table-count change (stays 31), no new enums, no RLS
or grant changes.** All columns are **nullable, no DEFAULT** — existing rows are
untouched and a re-import fills them through the additive upsert (`vocab_progress`
never touched).

- **`vocab_card` new columns:**
  - `synonyms text[]`, `collocations text[]`, `word_family text[]` — learning
    semantics for a card. Parser caps: ≤20 items each, ≤200 chars per item.
  - `quiz_prompt text` — a fill-in-the-blank sentence for the quiz mode; the parser
    requires it to contain the blank marker `___` when present (≤500 chars).
  - `accepted_answers text[]` — answers accepted for that blank (≤10 items, ≤200
    chars each). Absent when `quiz_prompt` is set = valid (the fallback answer is the
    card's `word`); an explicitly-empty array is a parse error (a typo, not "no
    answers").
- **`vocab_deck` new column:**
  - `question_types text[]` — canon question-type slugs the deck's quiz can draw from
    (validated by the parser against `QUESTION_TYPES` in `question-types.ts`; an
    unknown slug is a `VocabParseError`, ≤10 items). Mirrors
    `content_item.question_types` (a plain `text[]` of slugs).

- **Why NO answer_key-style lock on the new columns (RLS posture unchanged):**
  `vocab_card` stays the same secure-by-default published-read content row as in 0037
  (self-graded study material — see the 0037 note). `quiz_prompt`/`accepted_answers`
  are the **same data class**: the answer to the blank is the card's own `word`, which
  the user already sees on a published card — there is no *hidden* graded key to
  protect (unlike `answer_key`, whose leak would let a client pre-grade a scored test).
  So the new columns inherit their tables' posture; no lock table, no column-grant
  carve-out. `vocab_deck.question_types` is public catalog metadata (like
  `content_item.question_types`).

**Verification.** `tsc` clean; vitest green (parser + upsert enrichment cases);
`verify` gate green on local docker (still 31 tables; up→down→up clean + idempotent;
RLS asserts unchanged). Supabase application follows the plan's deploy sequencing.

## 0039 — Vocabulary level band (additive column on vocab_deck)

Additive column-only migration (product plan — level-organized Vocabulary catalog).
**No new tables, no table-count change (stays 31), no new enums, no RLS or grant
changes.** The single column is **nullable, no DEFAULT, no CHECK** — existing decks are
untouched (`NULL` → they render in a trailing "More decks" section) and a re-import
fills it through the additive deck upsert.

- **`vocab_deck` new column:**
  - `level_band text` — the deck's CEFR level for the level-sectioned catalog grid.
    Canon is exactly `{B1, B2, C1}`, **validated in the app layer** (the parser rejects
    anything else with a `VocabParseError`, case-sensitive after trim); the DB column
    carries **no CHECK / enum**, mirroring the precedent of `question_types` (canon lives
    in code, not a DB enum) and the free-text `level` column. Keeping validation in the
    parser lets the canon evolve without a migration and matches how tier / question-type
    slugs are policed.

- **Catalog use (presentation only, no gating):** `level_band` drives grouping — the grid
  splits decks into B1/B2/C1 sections (display order = `LEVEL_ORDER` in
  `src/lib/vocab/level.ts`) and badges the section matching `bandToCefr(profile.target_band)`
  as "Recommended". `target_band` is read on the profile row `getVocabOverview` already
  fetches (no extra round-trip). It never gates deck access (tier does); an unknown /
  `NULL` value simply falls into "More decks".

- **RLS posture unchanged:** the column inherits `vocab_deck`'s published-read posture —
  public catalog metadata like `level` / `question_types`, nothing to lock.

**Verification.** `tsc` clean; vitest green (parser `level_band` cases + `bandToCefr`
boundary tests); `verify` gate green on a throwaway local DB (still 31 tables; up→down→up
clean + idempotent; RLS asserts unchanged). Supabase application follows the plan's deploy
sequencing.

## 0040 — mistake_resolution (P9-rich «вариант B»)

PRACTICE_PLAN Фаза 3, волна B (mistake-review loop). One **additive** table storing
ONLY the fact "this mistake was worked off" (a resolution). **Open mistakes are never
materialized** — they are derived at read-time (`getOpenMistakes`,
`src/lib/practice/mistakes.ts`) from a user's `attempt_review_snapshot` (D3) +
`attempt.answers`, run through the same `gradeOne` grader as submit, deduped by the
freshest attempt per `(content_item, question)`, then minus the resolution rows. This is
the whole point of "вариант B": **`submitAttempt`, grading, rating and the daily cap are
untouched** — no new write into scored data, and legacy attempts without a snapshot
(pre-`0021`) are simply skipped (the derive inner-joins the snapshot). Bumps the app table
count **31 → 32**. **No new enums** (`qtype` is a denormalized `text` slug, not the
`question_type` enum — the server action resolves it authoritatively from `question`,
never trusting the client label).

- **`mistake_resolution`** — per-user resolution record. Purpose: mark a wrong question as
  learned so it drops out of the derived open-mistakes queue. Provenance: PRACTICE_PLAN
  волна B (2026-07-07). **Owner-read** like `vocab_progress` (RLS `SELECT TO authenticated
  USING (user_id = auth.uid())`), **written ONLY owner-path** by the `resolveMistake` server
  action — there is **no** `INSERT`/`UPDATE`/`DELETE` policy and `REVOKE ALL FROM anon,
  authenticated, PUBLIC` strips Supabase's default-priv grants; only `SELECT` is re-granted
  to `authenticated`. The action takes `user_id` **only** from the auth session (never the
  form), mirroring the practice-actions gate; `qtype` is looked up server-side from
  `question` by `(content_item_id, number)` — a non-existent question is a silent no-op,
  so a forged call cannot invent rows for questions that aren't in the test.
  - **Staleness semantics (anti-forge + re-fail reopen):** the derive subtracts a
    resolution ONLY when `resolved_at >= attempt.submitted_at` of the newest attempt on
    that question. A resolution created BEFORE an attempt never masks it — so a forged
    "resolve in advance" is inert, and a user who re-fails a question after marking it
    learned sees it reopen.
  - **Columns:** `user_id` + `content_item_id` (both FK `ON DELETE CASCADE`),
    `question_number int`, `qtype text` (denormalized slug snapshot at resolution time),
    `resolved_at timestamptz`. **`UNIQUE(user_id, content_item_id, question_number)`** is the
    idempotency foundation (`resolveMistake` inserts `ON CONFLICT DO NOTHING`).
  - **Indexes:** the unique constraint's leftmost `user_id` already serves the owner-read
    query (`WHERE user_id = $1`) and the RLS `user_id = auth.uid()` policy, so a standalone
    `(user_id)` index would be redundant and is intentionally omitted (deviation from the
    literal plan text, which asked for a `(user_id)` index — the constraint already provides
    it). A dedicated `(content_item_id)` index is added instead, because `content_item_id`
    is **not** leftmost in the unique constraint and would otherwise seq-scan on a
    `content_item` cascade-delete (same rationale as `vocab_progress.card_id`).
  - **Why NO answer_key-style lock:** the table holds only `(user_id, content_item_id,
    question_number, qtype)` — no correct answers, explanations or evidence. The derived
    open-mistakes list handed to the client also carries ONLY `{contentItemId, title,
    section, questionNumber, qtype, attemptId, submittedAt}`; `accept`/`explanation`/
    `evidence` stay server-side inside the derive (the snapshot is read owner-path and its
    `accept` is used only for `gradeOne`). The user sees correct answers through the
    existing practice-reveal, not this screen.

- **`verify.ts` companion edits (landed in the same change):** (1) `APP_TABLE_COUNT`
  **31 → 32**; (2) `mistake_resolution` added to the owner-read cohort assertion (§4i loop:
  RLS on + anon denied); (3) a `mistake_resolution` `INSERT`-denied case added to
  `clientWriteLockdown` (§6) mirroring the `vocab_progress` write-lockdown assertion.

**Verification.** `tsc` clean; vitest green (pure `deriveOpenMistakes` — dedup / minus
resolutions / mapping / ordering / unanswered-as-wrong). Migration round-trip on the local
throwaway DB: `db:up:local` → `db:down:local` → `db:up:local` clean + idempotent. Supabase
application (additive; apply before the code push to avoid a deploy-window break) follows the
plan's deploy sequencing.
