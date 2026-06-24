# IELTS Platform

Premium IELTS prep — Reading & Listening core. See **[BRIEF.md](./BRIEF.md)** for
the full product/engineering spec (single source of truth).

> **Phase 1, steps 0–1** (scaffold + DB schema + migrations) is implemented here.
> No auth flows, import parser, or UI yet — those are later steps in §9.

## Stack

Next.js (App Router) + TypeScript · Postgres (Supabase) · Drizzle ORM ·
Supabase Auth/Storage · deploy Vercel + CDN. (§6)

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the four required vars (see below)
```

Required env (`npm run verify` and the DB client fail fast if any is missing):
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`.

## Run

```bash
npm run dev        # Next.js dev server  -> http://localhost:3000
```

Routes: `/` (landing) · `/auth` (email sign-in/up) · `/app` (dashboard, auth-gated) ·
`/admin` (role=admin) · `/api/health`. Auth is Supabase (email now; Apple/Facebook
when OAuth keys exist — §10). Live sign-in needs a real Supabase project: set
`SUPABASE_*` and `NEXT_PUBLIC_SUPABASE_*` in `.env.local`. A new auth user
auto-gets a `profile` row via the `on_auth_user_created` trigger
(`migrations/0002_auth`).

## Database

```bash
npm run db:migrate # apply migrations (up)
npm run db:status  # show applied / pending
npm run db:down    # revert all (down)
npm run db:generate# (future) regenerate Drizzle SQL from src/db/schema.ts
```

Migrations are hand-authored up/down SQL in `migrations/` (applied by
`scripts/migrate.ts`); `src/db/schema.ts` is the typed Drizzle source of truth.
RLS lives in `migrations/0001_rls` — `answer_key` is locked to the service role
(BRIEF §6.1). See **[SCHEMA_NOTES.md](./SCHEMA_NOTES.md)** for resolved ambiguities.

## Verify (acceptance gate)

`npm run verify` runs against `DATABASE_URL` and prints `[OK]`/`[FAIL]` per check
(migrate up → 16 tables · down → clean revert · up → idempotent · anon denied on
`answer_key` · `/api/health` → 200), exit 0 only if all pass.

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

## Content licensing

Test HTML/audio belong to the **client**; this repo is the platform. Licensing of
source materials is the client's responsibility (BRIEF §11).
