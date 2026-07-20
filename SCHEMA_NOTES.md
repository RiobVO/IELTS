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
