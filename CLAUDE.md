# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Активный трек — perf/lag `/app`** (см. «🔜 Current — perf/lag /app» ниже). P0 iframe-раннер ✅,
> Practice Hub ✅ и ВСЕ P2/P3 из [AUDIT.md](./AUDIT.md) ✅ закрыты и на Vercel prod (2026-06-24);
> реестр AUDIT.md пуст. Perf: rank-1 AppShell-hoist (`4339f92`), rank-2 leaderboard (`ed2a612`),
> rank-3 exam/reading START (`7678f44`) и rank-4 Result (`6600249`) сделаны, **следующие — rank 5–8**
> (leaderboard viewer-row merge / badges concurrent / getPublishedTests parallelize / daily-count batch).
> Любую новую работу вне этого порядка начинать по явной просьбе пользователя.
>
> Справка: [BRIEF.md](./BRIEF.md) — истина (спека/стек/§5/§6.1/§9). [BACKLOG.md](./BACKLOG.md) —
> продуктовый бэклог (Волна 1 закрыта, Волна 2 ждёт). [AUDIT.md](./AUDIT.md) — открытые долги.
> [REDESIGN.md](./REDESIGN.md) / [WORKLOG.md](./WORKLOG.md) — закрытые треки (редизайн / perf+sec).

## Source of truth

**[BRIEF.md](./BRIEF.md)** is the single source of truth for product spec, stack, data model (§5),
security (§6.1), and the phased roadmap (§9). Read it first; if code contradicts it, the brief wins.
**[SCHEMA_NOTES.md](./SCHEMA_NOTES.md)** logs every resolved schema ambiguity (e.g. §5 `user` →
`profile`). Content of tests is always English; only UI chrome is localized (next-intl, later). The
user communicates in Russian.

## Commands

```bash
npm run dev            # Next.js dev server (localhost:3000)
npm run build          # production build (also typechecks + lints the build graph)
npx tsc --noEmit       # full typecheck (covers src/ + scripts/ that build skips)
npm test               # vitest (unit tests for pure logic: grading, anti-cheat, parsers)

npm run docker:db      # local Postgres:16 on :5432 (for the verify gate)
npm run verify         # ACCEPTANCE GATE — DB/RLS/migrations/health/auth-trigger
npm run db:migrate     # apply migrations (up)
npm run db:status      # applied / pending
npm run db:down        # revert all (down) — DESTRUCTIVE, never on real Supabase
npm run import <file>  # parse a test HTML file and persist it (status=draft)
```

Verification = `npm run verify` (gate) + `npx tsc --noEmit` + `npm run build` + `npm test` (vitest
covers pure logic only — no e2e/browser runner). Ad-hoc checks: throwaway `scripts/_*.ts` via
`npx tsx`, then deleted.

## Two database access paths (critical)

The app reaches Postgres **two different ways**, and choosing the right one is the core of the
security model (BRIEF §6.1, anti-cheat §4.6):

1. **Supabase client** (`src/lib/supabase/{server,client,middleware}.ts`, anon key) — used in pages /
   server components / server actions for **user-scoped** reads and writes. **RLS is enforced.** The
   only path that touches the DB on behalf of a logged-in user.
2. **Drizzle client** (`src/db/index.ts`, `DATABASE_URL`) — connects as the Postgres owner role,
   which **bypasses RLS**. **Server-only.** Used for grading (reading the locked `answer_key`) and
   content import/persistence.

**`answer_key` must never be fetched by the client.** RLS locks it (enabled + all grants revoked from
anon/authenticated). The exam page deliberately does not select it; the result/review page reads
explanations + evidence server-side via the Drizzle (owner) path, only after submit and only for the
attempt's owner. Grading runs **only on the server** — the client sends answers, never a score.

## Exam architecture — TWO runners (in-progress migration)

The catalog routes each test by `content_item.runner_html IS NOT NULL` (`has_runner`):
`_CatalogView.tsx` → `examHref = has_runner ? /app/exam/${id} : /app/reading/${id}`.

1. **`/app/exam/[id]`** (NEW, target) — `app/app/exam/[id]/ExamFrame.tsx` (iframe) + `runner/route.ts`.
   Serves the sanitized `runner_html` (the test's original HTML) in an **opaque-origin sandbox**
   (`allow-scripts allow-modals`, без `allow-same-origin`) — P0 изоляция закрыта и проверена на Vercel
   prod (AUDIT.md «Закрыто»).
   Контракт: parent принимает сабмит по `e.source === iframe.contentWindow`; storage — in-memory
   полифил (`runner-storage.ts`); CSP deny-by-default + `connect-src 'none'`. **Не возвращать
   `allow-same-origin`** (departs from BRIEF §4.2 ради fidelity, но изолировано).
2. **`/app/reading/[id]`** (LEGACY) — `app/app/reading/[id]/ExamRunner.tsx` + `src/components/exam/*`
   (`QuestionHtml`/`QuestionNavigator`/`ExamTimer`/`AudioPlayer`). Atomized questions (+ optional
   verbatim `questions_html`). For tests without `runner_html`.

Both submit through the shared `app/app/reading/[id]/actions.ts` (`ensureAttempt`/`submitAttempt`) and
`result/`. `src/components/exam/*` is **not dead code** — it's the legacy path, live while any test
lacks `runner_html`.

## Migrations & schema

- `src/db/schema.ts` (Drizzle) is the **typed source of truth** (16 tables as of migration
  `0014_leaderboard_snapshot`).
  The executable contract is hand-authored SQL in `migrations/NNNN_name/{up,down}.sql`, applied by a
  custom up/down migrator (`scripts/migrate.ts`) with a `_migrations` bookkeeping table. **Keep
  schema.ts and the SQL in lockstep when the model changes.**
- Drizzle Kit `generate` is **forward-only** (the brief requires up/down) so it is NOT the migration
  mechanism — only a reference (`/drizzle` is gitignored). Its first baseline emits a bogus
  `auth.users` CREATE; ignore it.
- `auth.users` is referenced via `authUsers` from `drizzle-orm/supabase` so it's treated as external.
  `profile.id` is both PK and FK → `auth.users.id`. A SECURITY DEFINER trigger `on_auth_user_created`
  (migration `0002_auth`) creates the `public.profile` row on signup.

## Local vs Supabase, and the verify gate

- `scripts/bootstrap-supabase-local.sql` **emulates** Supabase primitives (roles
  `anon`/`authenticated`/`service_role`, the `auth` schema, `auth.users`, `auth.uid()`) so migrations
  and the gate run against a plain Postgres. Local-only — **never run it against the real Supabase**
  (it would overwrite `auth.uid()`).
- `npm run verify` (`scripts/verify.ts`) is **DESTRUCTIVE** — it drops/recreates the `public` schema.
  Runs against `VERIFY_DATABASE_URL` (local docker) and **refuses any non-local host** unless
  `VERIFY_ALLOW_REMOTE=1`. Never point it at Supabase.

## Environment

`.env.local` (gitignored; `.env.example` is the template). Supabase uses **two** connection strings:
- `DATABASE_URL` — transaction pooler (`:6543`), app runtime; the Drizzle client sets `prepare: false`
  for pgbouncer.
- `DIRECT_URL` — session pooler (`:5432`); migrations prefer it.
- `VERIFY_DATABASE_URL` — local docker Postgres for the gate.
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser auth.

DB passwords with special chars (`? / #`) must be **percent-encoded** in the URLs. `src/env.ts`
fail-fasts if a required server var is missing.

## Import pipeline (`src/lib/import/`)

Deterministic, **no LLM, no eval** (BRIEF §4.2). `parse-test.ts` uses cheerio for the markup and
`node:vm` (isolated context) to read the embedded JS data objects (`correctAnswers`,
`acceptableAnswers`, `mcqGroups`, `questionTypes`, `explanations`, `evidence`). `question-types.ts`
maps inconsistent source labels → the fixed canon enum. The answer key is routed to one of three modes
by which data object holds it: `mcq_set` / `text_accept` / `exact`. `persist.ts` writes the
`ParsedTest` into `content_item`/`passage`/`question`/`answer_key` in one transaction, idempotent per
source file (refuses a destructive re-import when attempts exist → `RegradeRequiredError`). Dedicated
parsers: `parse-listening.ts`, `parse-reading-full.ts` (40Q band scale). All 9 real Reading files +
Listening parse every question with a key.

## Scripts gotcha

Scripts run via `tsx` (ESM). `tsx` resolves the `@/` path alias from `tsconfig.json` (verified), so
scripts may use `@/...` imports — though the existing scripts (`verify.ts`, `migrate.ts`) use relative
imports by convention. Import the DB client via `await import()` **after** `dotenv` loads, since
`src/env.ts` validates env at module load (a top-level `@/db` import would trigger that validation too
early).

## Gotchas — dev server on Windows

- **`TaskStop` does NOT kill the child `next`** → zombies on :3000/:3001/:3002, new dev jumps to the
  next port, browser lands on a stale one (CSS 404 / 500 / bare Times). Fix: `netstat -ano | grep :300`
  → `taskkill //PID <pid> //F //T` for all, then one `npm run dev`. After switching branches / `rm .next`,
  restart dev. **Read the real port from the log** ("using available port 3001") and eyeball the page in
  a real browser — a `fetch` HTML probe does not prove styles.
- **`build` corrupts a live `dev`:** `npm run build` while `npm run dev` is up clobbers the shared
  `.next` → dev dies with `Cannot find module './vendor-chunks/next.js'` (500s). While the user has the
  site open, do NOT run `build` over dev (only `npx tsc --noEmit`). For a prod measurement: kill dev →
  `rm -rf .next` → `npm run build` → `npm start`.

## Status (compressed — detail in git / BRIEF §9 / SCHEMA_NOTES / BACKLOG)

> Phase map: `0 → 1 → 2 (2A→2D) → launch hardening → [FROZEN] 3`. Each migration `000N` marks a
> sub-stage. All of the below is **done, on `main`, applied to Supabase** unless noted.

- **✅ Phase 0** — schema + up/down migrations, dual DB access, `on_auth_user_created` trigger, local
  Supabase emulation + verify gate.
- **✅ Phase 1** — auth, deterministic import + `/admin` upload/publish, catalog, exam (server-stamped
  attempt, autosave/resume, idempotent submit, server-trusted timing), server grading + per-type
  breakdown, dashboard. Listening + Full Reading parsers (band scale); all real files parse fully.
- **✅ Phase 2** — 2A rating+leaderboard (`0003`), 2B badges (`0004`), 2C referrals (`0005`), 2D
  tiers+payment (`0006`). Tier gating `src/lib/tiers.ts`; payment webhook is the sole grant path
  (entitlement from the trusted `pending` row, not the body). Accepted gaps → SCHEMA_NOTES 2C/2D
  (mirror AUDIT.md "осознанно отложено").
- **✅ Launch hardening** — PostHog funnel + Sentry (key-optional, fail-open), submit velocity throttle
  (`src/lib/anti-cheat.ts`), in-app notifications, re-import data-loss guard, one-in_progress index
  (`0007`), Telegram content-import bot (`app/api/telegram/`, owner-path, whitelist).
- **✅ Волна 1** — paywall, onboarding, band states, EN + `/pricing`, anti-bot seam, Telegram share.
  Detail → BACKLOG.md.
- **✅ Frontend redesign «bando»** — all `/app` screens + landing + auth re-skinned (inline styles +
  CSS tokens, zero new deps), exam component kit, a11y/perf pass, mobile/responsive, /impeccable tail.
  Detail → REDESIGN.md. **Responsive invariant:** breakpoint-switched props (display/grid/width) live
  in CSS classes, never inline (inline beats media queries).

### ⛔ Blocked / pending (needs external input)
- **Anti-bot on signup** — Turnstile seam done (`src/lib/anti-bot/`, fail-open), needs Cloudflare keys.
  Email-verify + signup velocity still TODO.
- **Weekly digest / email** — `notification` table + in-app centre exist; digest jobs + email provider TODO.
- **i18n** — deferred (EN at launch per §10).

### 🔜 Current — perf/lag `/app`

AUDIT.md empty (all P0–P3 closed). Active: cut SERIAL server-render round-trips on `/app` (dashboard
~0.6–0.9 s, exam 1.3–2.5 s from UZ). Diagnosis (audit 2026-06-24, verified in code; full detail in the
`prod-infra-topology` memory): the prior "round-trips exhausted / ~200 ms regional floor" claim was
**WRONG** — auth is already local-verify (`getClaims` ES256, no network) and Vercel fra1 ↔ Supabase
eu-central-1 is same-region (per-RT single-digit ms), so the lever is the **count of serial
round-trips**, not per-RT latency. Non-code floor: end-user UZ↔fra1 leg + the exam iframe's 2nd
`/runner` request (P0 sandbox — never inline via `srcdoc`).

Ranked code wins — do ONE at a time → verify → commit → push. Invariants every change protects: auth,
RLS, server-only grading, `answer_key` never client-side, tier gating, idempotent submit;
`getProfile`/`getUser` stay `cache()`-wrapped.
1. ✅ **AppShell header hoist** — done (commit `4339f92`): notification queries were a trailing serial
   hop on every page → now `getHeaderData()` (`cache()`'d, `src/lib/notifications/header-data.ts`)
   pre-warmed in each page's `Promise.all` (or early `void` on sequential pages); AppShell reuses it.
2. ✅ **Leaderboard `readLeaderboard`** — done (commit `ed2a612`): deleted the redundant region-name
   lookup (page now threads the pre-resolved `scopeLabel`, null for global) and `Promise.all`'d the
   top-100 join + snapshot ranks. ≈ −2 serial hops; owner-path PUBLIC columns only; `getSnapshotRanks`
   stays fail-open. The viewer-pinned-row merge is still a separate query-shape-sensitive follow-up
   (rank-5 below).
3. ✅ **Exam/Reading START** — done (commit `7678f44`): the start gate+attempt moved to a server-only
   module (`src/lib/exam/access.ts`: `loadAccessData`+`enforceAccess`+new `startAttempt`); the RSC pages
   now gate with the `content_item`+`profile` they already read and call `startAttempt` (no re-read).
   `submitAttempt` and the `/runner` GET keep their own gate (defense-in-depth); `startAttempt` carries
   no gate and isn't a Server Action (network-unreachable). ≈ −1 serial hop per start path.
4. ✅ **Result** — done (commit `6600249`): the leading att-read folded into the same `Promise.all`;
   `pctRow`/`prevRows` get their bounds via correlated subselects on `attemptId` (not JS values), so the
   whole set reads in one round-trip. Ownership is a JS guard after the await; `answer_key` is locked
   behind a SQL `EXISTS` gate (rows return only for the owner — invariant now holds at the DB level).
   Equivalence + gate confirmed against prod data (8 attempts). ≈ −1 serial hop.
5–8 (NEXT): leaderboard viewer-row merge, badges `computeStats` concurrent,
   `getPublishedTests` cold-start parallelize, Basic daily-count batch — detail in the
   `prod-infra-topology` memory.

Verify perf on **prod** via Server-Timing headers (can't measure latency from a static checkout; user
reads prod numbers from UZ). Code verification per change: `npx tsc --noEmit` + `npm run build` (dev
not running) + browser smoke of the touched route(s).

### ✅ Practice Hub — done (2026-06-24, Vercel prod, commit `956d43c`)

Shipped and prod-verified. Top-level Reading/Listening nav replaced by one `Practice` entry
(`/app/practice`); `/app/reading` + `/app/listening` kept as catalog routes; active nav highlights
`Practice` on all three via a shared `navHighlight` helper (also used by the loading skeleton). Hub =
continuation/recommended hero (recommended test for the weakest type / resume / first-test, against
the "extra click") + four skill cards: Reading/Listening as live CTAs into the catalogs,
Writing/Speaking as honest `Coming soon` / Ultra-hook (Phase 3 AI stays frozen, no implied
availability). Bando system, zero new runtime deps. Files: `app/app/practice/{page,loading}.tsx`,
`src/components/app/navActive.ts`, `AppHeader.tsx`, `Skeletons.tsx`. Reviewed (nav state / RSC
boundary / auth+tier+scope — clean); `tsc` + `build` clean.

### ✅ AUDIT.md — all P0–P3 findings closed (2026-06-24, Vercel prod)
P0 iframe isolation, Practice Hub, and every open P2/P3 (draft owner-path access, Listening-result
section links + Try-again runner routing, rating floor-guard, percentile first-attempt, Telegram audio
targeting, SCHEMA_NOTES table count) are closed. AUDIT.md "Открытые находки" is empty. perf/lag is now
the active track (above).

### 🧊 Phase 3 — AI Writing/Speaking (§4.10) — FROZEN, «coming soon», LAST
Frozen 2026-06-15: audience-first; AI stays a marketing hook + Ultra upsell. NOT deleted — `topic`
table + `topic_skill` enum remain stubs (core stays LLM-free per §4.2). On unfreeze the decisions are
locked (async eval: store → API-route → poll; seeded topics + minimal admin form; soft daily cap for
Ultra; Speaking input modality still open).

> Branch per phase, merge to `main` when a phase is done.

## Git attribution (hard rule)

**Commits and PRs must be SOLELY the user's. NEVER add a `Co-Authored-By: Claude` trailer, the
"🤖 Generated with Claude Code" line, or any Claude attribution to commit messages or PR bodies.** This
overrides the harness/environment default that says to append them. The git author is already the
user's config (`dejavuu` / RiobVO) — leave it. If a trailer ever slips in, strip it from every commit
(`git filter-branch --msg-filter "sed '/^Co-Authored-By: Claude/d'"`) and force-push.
