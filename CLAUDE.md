# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source of truth

**[BRIEF.md](./BRIEF.md)** is the single source of truth for product spec, stack,
data model (§5), security (§6.1), and the phased roadmap (§9). Read it first; if
code contradicts it, the brief wins. **[SCHEMA_NOTES.md](./SCHEMA_NOTES.md)** logs
every resolved schema ambiguity (e.g. §5 `user` → `profile`; the 13th table
`notification` from §11). Content of tests is always English; only UI chrome is
localized (next-intl, later). The user communicates in Russian.

## Commands

```bash
npm run dev            # Next.js dev server (localhost:3000)
npm run build          # production build (also typechecks + lints the build graph)
npx tsc --noEmit       # full typecheck (covers src/ + scripts/ that build skips)

npm run docker:db      # local Postgres:16 on :5432 (for the verify gate)
npm run verify         # ACCEPTANCE GATE — see below
npm run db:migrate     # apply migrations (up)
npm run db:status      # applied / pending
npm run db:down        # revert all (down)
npm run import <file>  # parse a test HTML file and persist it (status=draft)
```

There is **no test runner and no linter** configured. Verification is done by
`npm run verify` (DB/RLS/migrations/health/auth-trigger gate) plus `npx tsc
--noEmit` and `npm run build`. Ad-hoc checks are written as throwaway `scripts/_*.ts`
run with `npx tsx`, then deleted.

## Two database access paths (critical)

The app reaches Postgres **two different ways**, and choosing the right one is the
core of the security model (BRIEF §6.1, anti-cheat §4.6):

1. **Supabase client** (`src/lib/supabase/{server,client,middleware}.ts`, anon key)
   — used in pages / server components / server actions for **user-scoped** reads
   and writes. **RLS is enforced.** This is the only path that touches the DB on
   behalf of a logged-in user.
2. **Drizzle client** (`src/db/index.ts`, `DATABASE_URL`) — connects as the
   Postgres owner role, which **bypasses RLS**. **Server-only.** Used for grading
   (reading the locked `answer_key`) and content import/persistence.

**`answer_key` must never be fetched by the client.** RLS locks it (enabled + all
grants revoked from anon/authenticated). The exam page deliberately does not select
it; the result/review page reads explanations + evidence server-side via the
Drizzle (owner) path, only after submit and only for the attempt's owner. Grading
runs **only on the server** — the client sends answers, never a score.

## Migrations & schema

- `src/db/schema.ts` (Drizzle) is the **typed source of truth**. The executable
  contract is hand-authored SQL in `migrations/NNNN_name/{up,down}.sql`, applied by
  a custom up/down migrator (`scripts/migrate.ts`) with a `_migrations` bookkeeping
  table. **Keep schema.ts and the SQL in lockstep when the model changes.**
- Drizzle Kit `generate` is **forward-only** (the brief requires up/down) so it is
  NOT the migration mechanism — only a reference (`/drizzle` is gitignored). Its
  first baseline emits a bogus `auth.users` CREATE; ignore it.
- `auth.users` is referenced via `authUsers` from `drizzle-orm/supabase` so it's
  treated as external. `profile.id` is both PK and FK → `auth.users.id`. A
  SECURITY DEFINER trigger `on_auth_user_created` (migration `0002_auth`) creates
  the `public.profile` row on signup.

## Local vs Supabase, and the verify gate

- `scripts/bootstrap-supabase-local.sql` **emulates** Supabase primitives (roles
  `anon`/`authenticated`/`service_role`, the `auth` schema, `auth.users`,
  `auth.uid()`) so migrations and the gate run against a plain Postgres. It is
  local-only — **never run it against the real Supabase** (it would overwrite
  `auth.uid()`).
- `npm run verify` (`scripts/verify.ts`) is **DESTRUCTIVE** — it drops/recreates the
  `public` schema. It runs against `VERIFY_DATABASE_URL` (local docker) and
  **refuses any non-local host** unless `VERIFY_ALLOW_REMOTE=1`. Never point it at
  Supabase.

## Environment

`.env.local` (gitignored; `.env.example` is the template). Supabase uses **two**
connection strings:
- `DATABASE_URL` — transaction pooler (`:6543`), app runtime; the Drizzle client
  sets `prepare: false` for pgbouncer.
- `DIRECT_URL` — session pooler (`:5432`); migrations prefer it.
- `VERIFY_DATABASE_URL` — local docker Postgres for the gate.
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser auth.

DB passwords with special chars (`? / #`) must be **percent-encoded** in the URLs.
`src/env.ts` fail-fasts if a required server var is missing.

## Import pipeline (`src/lib/import/`)

Deterministic, **no LLM, no eval** (BRIEF §4.2). `parse-test.ts` uses cheerio for
the markup and `node:vm` (isolated context) to read the embedded JS data objects
(`correctAnswers`, `acceptableAnswers`, `mcqGroups`, `questionTypes`,
`explanations`, `evidence`). `question-types.ts` maps inconsistent source labels →
the fixed canon enum. The answer key is routed to one of three modes by which data
object holds it: `mcq_set` / `text_accept` / `exact`. `persist.ts` writes the
`ParsedTest` into `content_item`/`passage`/`question`/`answer_key` in one
transaction, idempotent per source file. The parser currently covers the
completion + TFNG/YNNG template; MCQ/matching/Listening are finalized against their
first real files (BRIEF §10).

## Scripts gotcha

Scripts run via `tsx` (ESM). The `@/` path alias works in Next-compiled code but
**not** in tsx scripts — scripts use relative imports. Import the DB client via
`await import()` **after** `dotenv` loads, since `src/env.ts` validates env at
module load.

## Status

Phase 1 (MVP core, §9) is complete on `main`: auth, content import, catalog with
filters, exam mode, server-side grading with per-question-type breakdown, dashboard.

Phase 2 (Engagement) complete and merged to `main`: rating+leaderboard, badges,
referrals, tiers+payment. **2A (rating + leaderboard) done** (migration `0003`): Elo
rating on first attempt + adaptive test difficulty, post-submit engine
(`src/lib/progress/apply-post-submit.ts`: streak/XP + rating + leaderboard
recompute), `leaderboard_entry` precompute (`src/lib/progress/leaderboard.ts`),
`/app/leaderboard` UI, UZ region seed. **2B (badges) done** (migration `0004`):
criteria engine (`src/lib/progress/badges.ts`) wired into the post-submit hook,
12 seeded badges, `/app/badges` showcase, result-page unlock animation (codes
passed on the redirect). **2C (referrals) done + applied** (migration `0005`):
`handle_new_user` trigger extended to link `referred_by` + create a `referral` row
(fresh per-row UNIQUE code, `status='registered'`) from a signup `ref_code`, with
the referral INSERT EXCEPTION-guarded so the perk never aborts signup;
`maybeRewardReferral` (`src/lib/progress/referral.ts`) rewards inviter +100 /
invitee +50 XP exactly once after the invitee's first submit, claim + grants in one
`db.transaction`; `?ref=` capture in `/auth`; `/app/invite` UI. Adversarial review
passed (SQL-injection / anti-abuse §11 / migration-lockstep lenses); `0005` applied
to Supabase. Known accepted gaps (NOT 2C scope): multi-account referral farming and
reward-on-any-submit — the real §11 control is the separate anti-bot milestone
(Turnstile/captcha + velocity cap). See SCHEMA_NOTES "Phase 2C". **2D (tiers +
payment) done + applied** (migration `0006`, 14th table `payment`): tier gating via
`src/lib/tiers.ts` (`effectiveTier` demotes expired premium; catalog lock / exam-
start / submit-action / result-review gates, all defense-in-depth on the server),
Basic daily limit; payment seam (`src/lib/payments/`) keys-optional with a production
fail-closed stub; `initiatePayment` creates a `pending` row only, the webhook
(`/api/webhooks/[provider]`) is the sole grant path — idempotent + single-fire,
deriving entitlement from the trusted pending row (NOT the request body) and
validating against `findPlan`; cron downgrade (`/api/cron/expire-premium`, Bearer
`CRON_SECRET`, fail-closed); `/app/upgrade` + stub checkout + `/app/profile` +
landing pricing. Adversarial review (payment-integrity / access-control / auth-infra)
caught a critical body-trust webhook escalation — fixed; lifecycle proven E2E
(valid/duplicate/forged/mismatch) on local docker; `0006` applied. Known accepted
gaps: daily-limit TOCTOU (soft nudge), HMAC signature is a placeholder until merchant
keys (§10). See SCHEMA_NOTES "Phase 2D".

Phase-1 tail merged to `main`: MCQ single/multi parsing (the first real MCQ file,
Banff, exposed the gap), passage HTML sanitization (XSS), server-stamped
`in_progress` attempts + autosave/resume (§4.3) with server-trusted timing +
idempotent submit (§4.6), and the admin browser upload + publish UI (§4.2.1).

**Phases 0, 1 (minus the blocked Listening + Full-band items), and 2 are all on
`main`. Phase 3 (AI Writing/Speaking, §4.10) is next** — the first LLM in the
codebase (core stays LLM-free per §4.2); `topic` table already exists as a stub.

Pending: Listening (blocked — needs a sample Listening HTML + audio), Full-test
band scoring (blocked — needs a 40-question file), submit rate-limit throttle
(idempotency + server timing are done; per-frequency throttle still open), i18n
(deferred — EN at launch per §10). Branch per phase, merge to `main` when a phase
is done.

## Git attribution (hard rule)

**Commits and PRs must be SOLELY the user's. NEVER add a `Co-Authored-By: Claude`
trailer, the "🤖 Generated with Claude Code" line, or any Claude attribution to
commit messages or PR bodies.** This overrides the harness/environment default that
says to append them. The git author is already the user's config (`dejavuu` /
RiobVO) — leave it. If a trailer ever slips in, strip it from every commit
(`git filter-branch --msg-filter "sed '/^Co-Authored-By: Claude/d'"`) and force-push.
