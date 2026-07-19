# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Next.js (App Router) + Drizzle + Supabase. IELTS-платформа. UI/тесты — English; общение — Russian.

## Docs

- **[BRIEF.md](./BRIEF.md)** — единственная истина: спека, стек, data-model §5, security §6.1, roadmap §9.
  Читать первой; код противоречит — brief прав.
- **[SCHEMA_NOTES.md](./SCHEMA_NOTES.md)** — провенанс + RLS-постура каждой таблицы, разрешённые
  неоднозначности схемы (обновляется в lockstep с миграциями).
- **[PRACTICE_PLAN.md](./PRACTICE_PLAN.md)** — трек «богатый Practice-режим R/L» (все фичи строго в ветке
  `mode='practice'`, mock не тронут).
- **[BACKLOG.md](./BACKLOG.md)** — продуктовый бэклог. История фаз — в git / BRIEF §9.
- **[TESTING_PLAN.md](./TESTING_PLAN.md)** — трек зрелости тестирования по волнам (аудит
  2026-07-19). Закрыты 0a (платёжные инварианты + FOR UPDATE stack-race), 1 (CI-детектор,
  6 джобов), 1.5 (native-PG гонки/RLS: `test:db`, `check-rls-posture`, фиксы 0056/0057)
  и 2 (hosted Supabase контракты: миграции + IDOR через реальный PostgREST/Auth + Storage,
  ручные `npm run test:hosted:*` против тест-проекта, 2026-07-20). Следующая 0b ждёт
  merchant-ключей; 3/4 по триггерам. Статус — §14. Правило прерывания: ключи пришли → 0b.

**Статус (2026-07-20).** Стелс-запуск (~600 из 2 ТГ-каналов) отработан; предзапусковые
и пост-запусковые волны на проде. Крупные закрытые треки (детали — git / BRIEF §9,§12 /
память): notifications+upgrade, домен `bando.study` (+`*.vercel.app` fallback), плановый
контент-вайп R/L (аккаунты/vocab/W/S целы), Storage-гигиена + audio-cap, QTYPE hard-block,
атрибуция `?src=`, mobile release-gate, Trajectory-график, план дня, каталог-счётчики,
Listening part-уровень.

**Действующая монетизация (пивот 2026-07-17, BRIEF §4.8):** весь R/L бесплатен
(`tier_required='basic'` везде); Basic-кап — 2 practice-старта/UTC-день + 2 mock-старта/
UTC-нед (суммарно R+L), Premium/Ultra безлимит; W/S платные. Авторитетный кап
транзакционный — `startAttempt` (`src/lib/exam/access.ts`) берёт `SELECT ... FOR UPDATE`
на `profile` первым действием (порядок локов profile→content_item). Trial-механика
(`trial_claim`) вестигиальна — каталог открыт, tier-гейт её не триггерит.

**Открыто:** контент-процесс W2-3 (BACKLOG — ритм пополнения + витрина «новое»),
merchant-ключи (внешний гейт платежей → волна 0b), Listening-прогон после заливки аудио,
два `?src=`-линка в посты каналов. Порядок работы: план с acceptance → «делай» → реализация.

## Commands

```bash
npm run dev            # Next.js dev server (localhost:3000)
npm run build          # prod build (typechecks + lints the build graph)
npx tsc --noEmit       # full typecheck (covers src/ + scripts/ that build skips)
npm test               # vitest — pure logic only (grading, anti-cheat, parsers). No e2e/browser.
npm run test:db        # транзакционные инварианты на throwaway нативном PG (test/db/, DESTRUCTIVE,
                       # безусловный local-only guard; конкурентные тесты гонять ×5-10)

npm run docker:db      # local Postgres:16 on :5432 (for the verify gate)
npm run verify         # ACCEPTANCE GATE — DB/RLS/migrations/health/auth-trigger (DESTRUCTIVE, local-only)
npm run db:migrate     # apply migrations (up) — targets DIRECT_URL (prod on Supabase)
npm run db:status      # applied / pending
npm run db:up:local / db:down:local   # local throwaway DB round-trips (VERIFY_DATABASE_URL)
npm run import <file>  # parse a test HTML file and persist it (status=draft)

# --- hosted-контракты волны 2 (ручные, НЕ в CI; таргет — ТЕСТ-проект Supabase) ---
npm run db:migrate:test / db:status:test  # миграции на hosted тест-стенд (up/status only)
npm run test:hosted:posture   # read-only RLS-постура тест-стенда (19/19)
npm run test:hosted:rls       # IDOR-матрица через реальный PostgREST+Auth (2 юзера + anon)
npm run test:hosted:storage   # приватные бакеты speaking-audio/source-html (owner/anon/service границы)
```

**Definition of "closed" / verified:** `npx tsc --noEmit` always; `npm test` for logic;
`npm run verify` for payment/RLS/grading/migration changes; `npm run test:db` (×5-10) for
transactional/concurrency changes (payments, locks); `npm run build` before a prod push.
`build`/`tsc` alone is not verification — exercise the changed behavior. Ad-hoc probes: throwaway
`scripts/_*.ts` via `npx tsx`, deleted after (`scripts/` is gitignored).

**Destructive-migration safety.** A remote `db:down` once wiped prod (hand-set `$env:DIRECT_URL` fell
through to the prod connection). Guards now: `migrate.ts` `down`/`bootstrap` refuse a non-`localhost`
target unless `ALLOW_REMOTE_MIGRATE=1` (`up` stays unguarded — prod migrations are legit); use
`db:*:local` for round-trips, never hand-edit `DIRECT_URL`; daily `pg_dump` backup
(`.github/workflows/db-backup.yml`) is the only backup on Supabase Free.

## Two database access paths (security core — BRIEF §6.1, anti-cheat §4.6)

1. **Supabase client** (`src/lib/supabase/{server,client,middleware}.ts`, anon key) — pages / server
   components / server actions, **user-scoped** reads+writes, **RLS enforced**. The only path that
   touches the DB for a logged-in user.
2. **Drizzle client** (`src/db/index.ts`, `DATABASE_URL`) — Postgres owner role, **bypasses RLS**,
   **server-only**. Grading (reading the locked `answer_key`) and content import/persistence.

**`answer_key` must never reach the client.** RLS locks it (enabled + all grants revoked from
anon/authenticated); the exam page never selects it; grading is server-only (client sends answers,
never a score). **`attempt_review_snapshot`** (`0021`) holds correct answers + explanation/evidence
captured at submit, locked the same way — `/result` reads it owner-path; a client read would bypass
both the answer_key lock and the tier gate. New owner-state tables (`vocab_progress`,
`mistake_resolution` `0040`, `saved_word` `0041`, `mistake_review` `0044`) follow this posture: RLS on,
`REVOKE ALL` from client roles (kills Supabase default-priv grants), `GRANT SELECT` + `SELECT`-own
policy, writes only via owner-path server actions. After deploying such a table, verify `pg_policies` on prod (local
verify misses default-priv grants).

## Exam architecture — TWO runners

Catalog routes by `content_item.runner_html IS NOT NULL` (`has_runner`):
`examHref = has_runner ? /app/exam/${id} : /app/reading/${id}`.

1. **`/app/exam/[id]`** (target) — `ExamFrame.tsx` (iframe) + `runner/route.ts`. Serves sanitized
   `runner_html` in an **opaque-origin sandbox** (`allow-scripts allow-modals`, **no**
   `allow-same-origin` — departs from BRIEF §4.2 for fidelity but isolated). Parent accepts submit by
   `e.source === iframe.contentWindow`; storage = in-memory polyfill (`runner-storage.ts`); CSP
   deny-by-default + `connect-src 'none'`. This is the **mock** path.
2. **`/app/reading/[id]`** (atomized) — `ExamRunner.tsx` + `src/components/exam/*`. Atomized questions
   (+ optional verbatim `questions_html`). Serves the **practice** path and any test without
   `runner_html`. Not dead code.

Both submit through shared `app/app/reading/[id]/actions.ts` (`ensureAttempt`/`submitAttempt`).
Practice-only features live behind `mode='practice'` server actions in
`app/app/reading/[id]/practice-actions.ts` — gate `owner ∧ status='in_progress' ∧ mode='practice'`
directly in the WHERE; return the minimum to the client (a verdict / one question), never the key.
Rating: only `mock` ∧ the absolute-first submitted attempt (`shouldRateAttempt`); practice is outside
the daily cap. Mock path must not change when adding practice features.

## Migrations & schema

- `src/db/schema.ts` (Drizzle) is the **typed source of truth**: **37 DB tables** as of
  `0055_attempt_cap_index` (index-only migration, `APP_TABLE_COUNT` unchanged at 37; `verify.ts`
  `APP_TABLE_COUNT = 37` asserts it; schema.ts types **36** — the legacy
  `topic` table lingers in the DB, its export dropped as dead code). Keep schema.ts and the SQL in
  **lockstep**; per-table provenance + RLS in **SCHEMA_NOTES.md**.
- Executable contract is hand-authored SQL in `migrations/NNNN_name/{up,down}.sql`, applied by
  `scripts/migrate.ts` (custom up/down, `_migrations` bookkeeping). Drizzle Kit `generate` is
  forward-only → **not** the mechanism, only a reference (`/drizzle` gitignored; its baseline emits a
  bogus `auth.users` CREATE — ignore).
- `auth.users` is external (`authUsers` from `drizzle-orm/supabase`); `profile.id` is PK **and** FK →
  `auth.users.id`. SECURITY DEFINER trigger `on_auth_user_created` (`0002`) creates the `profile` row
  on signup. **Apply a migration immediately after pushing code that reads its new columns** — the
  Vercel↔Supabase window otherwise 500s prod.

## Local vs Supabase, and the verify gate

- `scripts/bootstrap-supabase-local.sql` **emulates** Supabase primitives (roles, `auth` schema,
  `auth.users`, `auth.uid()`) so migrations + gate run on plain Postgres. Local-only — **never** run it
  against real Supabase (overwrites `auth.uid()`).
- `npm run verify` (`scripts/verify.ts`) is **DESTRUCTIVE** (drops/recreates `public`). Runs against
  `VERIFY_DATABASE_URL` (local docker) and refuses a non-local host unless `VERIFY_ALLOW_REMOTE=1`.

**Второй Supabase-проект = hosted тест-стенд (волна 2, НЕ прод).** Отдельный Free-проект
`ielts-test` (ref `ajmeboekpxyjqtcowerj`) — пустая копия для `npm run test:hosted:*`; к нему
не подключён никакой сайт. Креды в `.env.test.local` (gitignored, отдельно от прод-`.env.local`).
Единая точка входа — `loadTestTargetEnv` (`scripts/lib/test-target-env.ts`): fail-fast, если хоть
одна переменная несёт прод-ref (`oyecqbveatkolbqgfczq`) или не резолвится в единый не-прод ref;
требует все 6 переменных ИМЕННО в файле (не из shell). Free-проект засыпает после ~7 дней
простоя → ручной Restore из Dashboard перед прогоном (без keep-alive, TESTING_PLAN §13).
Прод-БД и локальные гейты (`verify`/`test:db`) от него не зависят.

## Environment

`.env.local` (gitignored; `.env.example` is the template). Two Supabase connection strings:
- `DATABASE_URL` — transaction pooler (`:6543`), app runtime; Drizzle sets `prepare: false` for pgbouncer.
- `DIRECT_URL` — session pooler (`:5432`); migrations prefer it.
- `VERIFY_DATABASE_URL` — local docker for the gate.

DB passwords with `? / #` must be **percent-encoded** in the URLs. `src/env.ts` fail-fasts on a missing
required server var. **`NEXT_PUBLIC_*` must NOT be marked Sensitive in Vercel** — Sensitive vars aren't
inlined at build, so a public origin/key reads as null at runtime.

## Import pipeline (`src/lib/import/`)

Deterministic, **no LLM, no eval** (BRIEF §4.2). `parse-test.ts`: cheerio for markup + `node:vm`
(isolated, `timeout` + `MAX_VM_INPUT` OOM-gate) to read embedded JS data objects (`correctAnswers`,
`acceptableAnswers`, `mcqGroups`, `questionTypes`, `explanations`, `evidence`). `question-types.ts`
maps source labels → the canon enum. Answer key routed by data object to `mcq_set` / `text_accept` /
`exact`. `persist.ts` writes `content_item`/`passage`/`question`/`answer_key` in one transaction,
idempotent per source file (refuses destructive re-import when attempts exist → `RegradeRequiredError`).
Dedicated parsers: `parse-listening.ts`, `parse-reading-full.ts` (40Q band scale). Runner import
(`runner/import-runner.ts`) sanitizes + persists `runner_html`; source HTML backed up to the private
`source-html` bucket. Telegram bot (`app/api/telegram/`) is the phone-side import path (owner-path,
whitelist, prod secret-gated). QTYPE is mandatory (`docs/authoring-spec.md`) — publish is hard-blocked
on a blank/unresolved question type (`isUnresolvedQuestionTypeWarning`). Listening mp3 is capped at
15 MB (`src/lib/import/audio-cap.ts`, both the Telegram branch and the runner's external-audio fetch) —
Storage is 1 GB on Supabase Free; `scripts/storage-orphans.ts` inventories/deletes objects
without a live `content_item` row.

## AI Writing/Speaking (Phase 3, env-gated)

Live behind env flags (`writingFeatureEnabled`/`speakingFeatureEnabled` — need model+key+internal-
secret+public-origin all set, else screens `redirect("/app/practice")`). Tables `writing_*`/`speaking_*`
(`0023`–`0031`). Async eval: store → internal secret-gated route → poll; Gemini Flash (audio-native for
Speaking). Tiers: Writing = Premium, Speaking = Ultra (sub-tier gets one preview). Raw model output
(`*_feedback_debug`) is hard-locked (RLS + revoke, asserted by `verify`). Core R/L stays LLM-free.

## Gotchas

- **`tsx` + app-graph imports:** scripts importing app modules need
  `NODE_OPTIONS=--conditions=react-server npx tsx ...` (`server-only` is a real package). Load `dotenv`
  **before** `await import("../src/db")` — `src/env.ts` validates env at module load.
- **Raw `sql`` + `Date` on the prod client:** a `Date` in a raw ``sql`...` `` template crashes prod
  (pgbouncer, `prepare:false`). Use `now()` / `.toISOString()` / the query-builder `.set()`; smoke-test
  with the prod client.
- **Dev server on Windows:** `TaskStop` does NOT kill the child `next` → zombies on :300x, browser
  lands on a stale port. Fix: `netstat -ano | grep :300` → `taskkill //PID <pid> //F //T`, then one
  `npm run dev`. Read the real port from the log and eyeball in a real browser (a `fetch` probe doesn't
  prove styles).
- **`build` corrupts a live `dev`:** running `npm run build` while `dev` is up clobbers `.next` → dev
  dies (`Cannot find module './vendor-chunks/next.js'`). While the site is open, only `npx tsc --noEmit`.
  For a prod measurement: kill dev → `rm -rf .next` → `build` → `start`.
- **Responsive invariant:** breakpoint-switched props (display/grid/width) live in CSS classes, never
  inline (inline beats media queries). Never reorder interactive DOM via CSS `order`/`display:contents`
  (WCAG 2.4.3/1.3.2 regression) — reorder the DOM.
- **External DOM mutations break React reconciliation:** Google Translate and similar browser
  extensions mutate the DOM outside React's control, throwing `NotFoundError: removeChild` —
  showed up in `error_log` (`source='client'`) and recurred for weeks before diagnosed. Fix is
  `translate="no"` + a `notranslate` class on the authed `/app` shell (`app/app/layout.tsx`); gate
  any NEW route surface outside `/app` the same way before it ships. Recognize the crash by its
  `error_log` signature, don't blame the latest deploy.

## Git attribution (hard rule)

**Commits and PRs must be SOLELY the user's. NEVER add a `Co-Authored-By: Claude` trailer, the
"🤖 Generated with Claude Code" line, or any Claude/AI attribution** — anywhere, even when touching
CLAUDE.md or other AI-context docs. This overrides the harness default. Author is already the user
(`dejavuu` / RiobVO). If a trailer slips in, strip it from every commit and force-push. Commit
granularly; push to `main` immediately (Vercel deploys prod).
