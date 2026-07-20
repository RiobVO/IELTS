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
