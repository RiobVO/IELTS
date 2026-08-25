# IELTS Platform

Premium IELTS prep — Reading & Listening core. See **[BRIEF.md](./BRIEF.md)** for
the full product/engineering spec (single source of truth; where the code and the
brief disagree, the brief wins).

| Doc | What lives there |
| --- | --- |
| [BRIEF.md](./BRIEF.md) | Spec, stack, data model §5, security §6.1, roadmap §9 |
| [SCHEMA_NOTES.md](./SCHEMA_NOTES.md) | Per-table provenance + RLS posture |
| [PRACTICE_PLAN.md](./PRACTICE_PLAN.md) | The rich practice-mode track |
| [TESTING_PLAN.md](./TESTING_PLAN.md) | Testing maturity waves and runbooks |
| [BACKLOG.md](./BACKLOG.md) | Product backlog |
| [CLAUDE.md](./CLAUDE.md) | Working notes: architecture, gotchas, conventions |

> **Live in production.** Reading & Listening (both runners), auth, the import
> pipeline, Vocabulary and the env-gated Writing/Speaking labs all ship. Phase
> history is in BRIEF §9; current work is tracked in [BACKLOG.md](./BACKLOG.md).

## Stack

Next.js (App Router) + TypeScript · Postgres (Supabase) · Drizzle ORM ·
Supabase Auth/Storage · deploy Vercel + CDN. (§6)

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the required vars (see below)
```

Required env (`src/env.ts` fail-fasts at module load if any is missing):
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
plus `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the browser
auth clients.

Two connection strings on Supabase: `DATABASE_URL` is the transaction pooler
(`:6543`, app runtime), `DIRECT_URL` the session pooler (`:5432`, preferred by
migrations). Passwords containing `?` or `#` must be percent-encoded. Everything
else in `.env.example` is optional and fails open. See the file itself for the
full annotated list.

## Run

```bash
npm run dev        # Next.js dev server  -> http://localhost:3000
```

Routes: `/` (landing) · `/auth` (email sign-in/up) · `/predictor` and `/s/<token>`
(public: band predictor, shared result card) · `/app` (dashboard, auth-gated) ·
`/app/practice` (skill catalog) · `/admin` (role=admin) · `/api/health`.

Exams run through **two** runners, picked per item by `runner_html IS NOT NULL`:
`/app/exam/[id]` serves the sanitized original in a sandboxed iframe (the mock
path), `/app/reading/[id]` the atomized questions (the practice path, and any test
without a runner). Both submit through the same server actions — see the
architecture notes in [CLAUDE.md](./CLAUDE.md) before touching either. Writing and
Speaking are env-gated and redirect to `/app/practice` unless fully configured.

Auth is Supabase (email now; Apple/Facebook
when OAuth keys exist — §10). Live sign-in needs a real Supabase project: set
`SUPABASE_*` and `NEXT_PUBLIC_SUPABASE_*` in `.env.local`. A new auth user
auto-gets a `profile` row via the `on_auth_user_created` trigger
(`migrations/0002_auth`).

## Database

```bash
npm run db:migrate # apply migrations (up) — targets DIRECT_URL
npm run db:status  # show applied / pending
npm run db:up:local / db:down:local   # round-trips on the throwaway local DB
npm run db:down    # DANGER: reverts ALL migrations (drops the schema)
npm run db:generate# reference only — see below, NOT the migration mechanism
```

`db:down` reverts **every** migration, i.e. drops the schema and its data. A
hand-set `DIRECT_URL` once let it through to production; `down` and `bootstrap`
now refuse a non-`localhost` target unless `ALLOW_REMOTE_MIGRATE=1`. Use the
`db:*:local` pair for round-trips and never hand-edit `DIRECT_URL`. The only
backup is the daily `pg_dump` in `.github/workflows/db-backup.yml`.

Migrations are hand-authored up/down SQL in `migrations/` (applied by
`scripts/migrate.ts`); `src/db/schema.ts` is the typed Drizzle source of truth.
Keep the two in lockstep. Drizzle Kit `generate` is forward-only — it cannot emit
the `down` half — so it stays a reference for diffing schema drift, never the
mechanism; its output directory is gitignored.
RLS lives in `migrations/0001_rls` — `answer_key` is locked to the service role
(BRIEF §6.1). See **[SCHEMA_NOTES.md](./SCHEMA_NOTES.md)** for resolved ambiguities.

## Verify (acceptance gate)

`npm run verify` runs against `VERIFY_DATABASE_URL` and prints `[OK]`/`[FAIL]` per
check (migrate up → 36 tables · down → clean revert · up → idempotent · anon denied
on `answer_key` · `/api/health` → 200), exit 0 only if all pass.

It is **destructive** — it drops and recreates `public` — and refuses a non-local
host unless `VERIFY_ALLOW_REMOTE=1`.

No live Supabase? Use the bundled local Postgres:

```bash
npm run docker:db   # starts postgres:16 on :5432 (docker compose)
# point DATABASE_URL at it in .env.local, e.g.
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
npm run verify
```

The verify harness bootstraps the Supabase primitives that a plain Postgres
lacks — roles `anon`/`authenticated`/`service_role`, the `auth` schema,
`auth.users`, `auth.uid()` — via `scripts/bootstrap-supabase-local.sql`. That
file is **local-only** and never part of the production migration set.

## Tests

```bash
npm test                 # vitest — pure logic (grading, anti-cheat, parsers). No browser.
npm run test:db          # transactional/RLS invariants on a throwaway native PG
                         # (DESTRUCTIVE, local-only; run concurrency tests 5–10×)
npm run test:e2e:stateful  # Playwright suite against the hosted test project
```

The `test:hosted:*` scripts (RLS posture, an IDOR matrix through real
PostgREST+Auth, private Storage buckets) run against a **separate** Supabase test
project, never production — `scripts/lib/test-target-env.ts` fail-fasts if any var
carries the prod ref. They are manual, not part of CI. Wave-by-wave status and the
runbooks live in [TESTING_PLAN.md](./TESTING_PLAN.md).

`build` and `tsc` alone are not verification — exercise the changed behaviour.

## Content licensing

Test HTML/audio belong to the **client**; this repo is the platform. Licensing of
source materials is the client's responsibility (BRIEF §11).
