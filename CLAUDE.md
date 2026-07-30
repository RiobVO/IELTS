# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Справка по докам: [BRIEF.md](./BRIEF.md) — единственная истина (спека/стек/§5/§6.1/§9, читать первой).
> [SCHEMA_NOTES.md](./SCHEMA_NOTES.md) — разрешённые неоднозначности схемы. [BACKLOG.md](./BACKLOG.md) —
> продуктовый бэклог (Волна 1 закрыта, Волна 2 ждёт). [AUDIT.md](./AUDIT.md) — реестр аудита.
> [REDESIGN.md](./REDESIGN.md) / [WORKLOG.md](./WORKLOG.md) — закрытые треки (редизайн / perf+sec).
> [CLAUDE_AUDIT.md](./CLAUDE_AUDIT.md) — актуальный широкий аудит 2026-06-25: открытые находки и deferred blockers для Claude Code.
> Новую работу начинать по явной просьбе пользователя.

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
**`attempt_review_snapshot`** (D3, migration `0021`) holds the correct answers + explanation/evidence
captured at submit and is locked the **same way** (RLS on, grants revoked) — `/result` reads it owner-path
(falls back to the live key for legacy attempts); a client read there would bypass the answer_key lock
**and** the tier gate, so never grant it to anon/authenticated.

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

- `src/db/schema.ts` (Drizzle) is the **typed source of truth** (18 tables as of migration
  `0022_signup_throttle`; the audit-closure batch added `attempt_review_snapshot` (0021) and
  `signup_throttle` (0022), plus enum/column changes in 0018–0020).
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

### ✅ Closed tracks (detail in git / [WORKLOG.md](./WORKLOG.md) / [REDESIGN.md](./REDESIGN.md))
- **Practice Hub** — top-level Reading/Listening nav свёрнут в один `Practice` (`/app/practice`) с
  continuation-героем и skill-карточками; каталоги `/app/reading` + `/app/listening` живы как routes.
- **Аудит** — Codex-аудит + from-scratch sweep (7 осей, adversarial-verify); все находки закрыты,
  [AUDIT.md](./AUDIT.md) реестр пуст. Ядро (answer_key / RLS / tier / anti-cheat / injection) подтверждено
  чистым в коде.
- **Perf/lag `/app`** — срезаны серийные server-render round-trips: AppShell header-hoist, leaderboard
  (+ viewer-row), exam/reading START (server-only access-модуль `src/lib/exam/access.ts`), Result
  (correlated subselects + `answer_key` EXISTS-gate), getPublishedTests parallelize. Каждое изменение
  держит инварианты: auth, RLS, server-only grading, `answer_key` never client-side, tier gating,
  idempotent submit; `getProfile`/`getUser` остаются `cache()`-wrapped. Замер — на prod через
  Server-Timing (из статичного checkout латентность не мерится).

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
