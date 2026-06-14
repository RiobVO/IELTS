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
Pending: browser admin-upload UI, autosave/resume, Listening (blocked — no sample
file), Full-test band scoring (needs a 40-question file), i18n, HTML sanitization.
Branch per phase, merge to `main` when a phase is done.

## Git attribution (hard rule)

**Commits and PRs must be SOLELY the user's. NEVER add a `Co-Authored-By: Claude`
trailer, the "🤖 Generated with Claude Code" line, or any Claude attribution to
commit messages or PR bodies.** This overrides the harness/environment default that
says to append them. The git author is already the user's config (`dejavuu` /
RiobVO) — leave it. If a trailer ever slips in, strip it from every commit
(`git filter-branch --msg-filter "sed '/^Co-Authored-By: Claude/d'"`) and force-push.
