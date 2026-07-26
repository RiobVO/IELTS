# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **⚠️ ТЕКУЩИЙ ТРЕК — [REDESIGN.md](./REDESIGN.md). Работаем СТРОГО по нему и только по нему.**
> Визуальный редизайн 6 экранов по дизайн-дропу (`design-drop/redesign/`): один экран =
> коммит+пуш в `main` + автогейт `tsc`+`build`+`vitest`; логику Волны 1 и grading/tiers НЕ
> ломаем; results — бесплатно через open-флаг (гейтинг не удалять). Порядок и контракт — в
> REDESIGN.md, читать его ПЕРВЫМ. Любую другую работу (новые фичи, Волна 2, perf) НЕ начинать
> без явной просьбы пользователя.
>
> [BACKLOG.md](./BACKLOG.md) — продуктовый бэклог (Волна 1 закрыта, Волна 2 ждёт после редизайна).
> [WORKLOG.md](./WORKLOG.md) — perf+security трек (закрыт). Оба — справка, активен REDESIGN.md.

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

Scripts run via `tsx` (ESM). `tsx` resolves the `@/` path alias from `tsconfig.json`
(verified), so scripts may use `@/...` imports — though the existing scripts
(`verify.ts`, `migrate.ts`) use relative imports by convention. Import the DB client
via `await import()` **after** `dotenv` loads, since `src/env.ts` validates env at
module load (a top-level `@/db` import would trigger that validation too early).

## Status

> Линейная карта фаз: `0 → 1 → 2 (2A→2B→2C→2D) → launch hardening → [FROZEN] 3`.
> Каждая миграция `000N` = маркер под-этапа. Высокоуровневый roadmap — BRIEF §9;
> разрешённые неоднозначности — SCHEMA_NOTES. AI (Phase 3) намеренно последняя и
> заморожена.

### ✅ Phase 0 — Foundation (on `main`)
DB schema (`schema.ts` + up/down SQL migrations), dual DB access (Supabase
anon+RLS / Drizzle owner), `on_auth_user_created` trigger, local Supabase
emulation + verify gate.

### ✅ Phase 1 — MVP core (on `main`)
*Done = студент проходит реальный тест и видит разбор по типам.*
- Auth (email + OAuth seams)
- Content import (deterministic parser, no LLM) + admin browser upload + publish UI (§4.2.1)
- Catalog with filters (category / question types)
- Exam mode: server-stamped `in_progress` + autosave/resume (§4.3), server-trusted timing, idempotent submit (§4.6)
- Server-side grading + per-question-type breakdown
- Dashboard
- *Tail:* MCQ single/multi parsing (gap exposed by the first real MCQ file, Banff), passage HTML sanitization (XSS)
- **Listening** — dedicated parser (`parse-listening.ts`: key in `KEY`, band as `band(r)` function materialized to a scale, `.part`/`.gap`/radio/`.dropzone`); persist (4 parts→passages, audio path, `band_scale`); exam audio player + Listening catalog. Real 40Q file verified end-to-end (parse + persist on local docker).
- **Full Reading** — `parse-reading-full.ts` (3 passages, `acceptableVariants` key, `getBand` scale, matching/classification radio tables, MCQ-two checkboxes, question→passage mapping); band scoring for Full tests (40Q) wired into submit + result. Closes the §11 band gap for Listening + Full Reading.
- **All single-passage question types** — single parser gained matching-headings (heading-drop + bank), matching-table rows, sentence-endings (`.ending-*`/`.dd-*`); **all 9 real Reading files now parse every question with a key** (was: Population 7/13, Tuatara 9/14, Happy 5/13, Animals 10/14).
- **Shared catalog** (`_CatalogView`) for Reading + Listening; exam route is content-generic.
- *Launch steps (NOT code — done at deploy):* load tests into the live DB via `/admin`; host audio in Supabase Storage (local `public/` for dev). Browser e2e (login + content) not yet eyeballed; every layer verified separately (parse probes on all files + persist on local docker + tsc + build).

### ✅ Phase 2 — Engagement (on `main`, all applied to Supabase)
- **2A — rating + leaderboard** (migration `0003`): Elo rating on first attempt +
  adaptive difficulty, post-submit engine (`src/lib/progress/apply-post-submit.ts`:
  streak/XP + rating + leaderboard recompute), `leaderboard_entry` precompute
  (`src/lib/progress/leaderboard.ts`), `/app/leaderboard`, UZ region seed.
- **2B — badges** (migration `0004`): criteria engine (`src/lib/progress/badges.ts`)
  wired into the post-submit hook, 12 seeded badges, `/app/badges` showcase,
  result-page unlock animation (codes passed on the redirect).
- **2C — referrals** (migration `0005`, applied): `handle_new_user` trigger links
  `referred_by` + creates a `referral` row (per-row UNIQUE code, `status='registered'`)
  from a signup `ref_code`, INSERT EXCEPTION-guarded so the perk never aborts signup;
  `maybeRewardReferral` (`src/lib/progress/referral.ts`) rewards inviter +100 /
  invitee +50 XP once after the invitee's first submit (claim + grants in one
  `db.transaction`); `?ref=` capture in `/auth`; `/app/invite` UI. Adversarial review
  passed (SQL-injection / anti-abuse / migration-lockstep).
  *Accepted gaps (NOT 2C scope):* multi-account farming, reward-on-any-submit — the
  real §11 control is the separate anti-bot milestone. See SCHEMA_NOTES "Phase 2C".
- **2D — tiers + payment** (migration `0006`, 14th table `payment`, applied): tier
  gating via `src/lib/tiers.ts` (`effectiveTier` demotes expired premium; catalog /
  exam-start / submit / result-review gates, defense-in-depth on the server), Basic
  daily limit; payment seam (`src/lib/payments/`) keys-optional with a production
  fail-closed stub; `initiatePayment` creates a `pending` row only, the webhook
  (`/api/webhooks/[provider]`) is the sole grant path — idempotent + single-fire,
  entitlement derived from the trusted pending row (NOT the request body), validated
  against `findPlan`; cron downgrade (`/api/cron/expire-premium`, Bearer `CRON_SECRET`,
  fail-closed); `/app/upgrade` + stub checkout + `/app/profile` + landing pricing.
  Adversarial review caught a critical body-trust webhook escalation — fixed;
  lifecycle proven E2E (valid/duplicate/forged/mismatch) on local docker.
  *Accepted gaps:* daily-limit TOCTOU (soft nudge), HMAC signature is a placeholder
  until merchant keys (§10). See SCHEMA_NOTES "Phase 2D".

### 🟡 Launch hardening — current focus (on `main`, §11 / §4.6)
- ✅ **Product telemetry (PostHog)** — server-authoritative funnel (`signup` /
  `test_start` / `test_submit` / `upgrade`, distinctId = Supabase user.id, not
  client-spoofable) + client pageview/identify provider; key-optional fail-open seam
  in `src/lib/analytics/` (no key → no-op; bounded flush; autocapture/session-replay
  off, URL query stripped for exam/auth privacy). Activated on a live US-cloud project.
- ✅ **Sentry** error monitoring — key-optional, fail-open.
- ✅ **Submit rate-limit throttle** (§4.6) — per-user velocity cap on submit
  (`src/lib/anti-cheat.ts`), the last open anti-cheat gap, now closed.
- ✅ **In-app notification centre** (§11) — commit `87cb048`.
- ✅ **Re-import data-loss guard** — `persistTest` refuses a destructive re-import
  when the test already has attempts (`RegradeRequiredError`), so re-importing a sat
  test can't FK-cascade away attempt history. (Full Re-grade — version bump +
  recompute + "score adjusted" mark — still deferred; this just stops the data loss.)
- ✅ **One in_progress attempt per (user, test)** — migration `0007` partial unique
  index + `ensureAttempt` `ON CONFLICT DO NOTHING`, closing the concurrent first-start
  race (two in_progress rows / doubled `test_start`). **Applied to Supabase**
  (verified in `_migrations` + `attempt_one_in_progress_idx` present on the live DB).
- ✅ **Telegram content-import bot** (`app/api/telegram/webhook/route.ts`,
  `src/lib/telegram/`) — admin-канал загрузки контента, дополняет `/admin` (тот же
  детерминированный pipeline `parseTest`→`persistTest`, без дублирования). HTML-тест →
  `draft`; для Listening mp3 → Supabase Storage (PUBLIC bucket `audio`, service-role),
  `passage.audio_path` → public URL; inline-кнопка «Опубликовать» → `published`
  (callback_query, зеркалит admin `setStatus` + `revalidateTag('content_item')`).
  Безопасность: secret-token + whitelist по Telegram user_id (`TELEGRAM_BOT_TOKEN` /
  `TELEGRAM_ADMIN_IDS` / `TELEGRAM_WEBHOOK_SECRET`), `/api/telegram` исключён из
  auth-middleware (пишет owner-путём в обход RLS). Ноль новых зависимостей (нативный
  fetch + уже стоящий `@supabase/supabase-js`); выключен без `TELEGRAM_BOT_TOKEN`
  (webhook no-op). Webhook на prod, все 3 этапа E2E проверены. Закрывает launch-аудио
  (теперь в Storage, не локальный `public/`).

### ✅ Продуктовый бэклог — Волна 1 (BACKLOG.md, 2026-06-18)
*«20 → 100» — продуктовые ходы из живого ревью прод-сайта. Все 7 пунктов закрыты, на проде, проверены вживую.*
- **W1-1+3 пейволл** (`058ffee`): per-type breakdown + ✓/✗ по вопросам — бесплатно; правильные
  ответы/объяснения/evidence — Premium (рендерятся только при `fullReview`, в HTML free не утекают).
- **W1-2 онбординг** (`26279d6`): 2-шаговый визард `/app/onboarding` — захват
  display_name/region/target_band (миграция `0012` `onboarded_at`, гейт на дашборде) +
  мини-диагностика (`723096f`: зашитый пассаж + 6 вопросов, клиентский грейд → слабый тип).
- **W1-4 band** (`d19046d`): три честных состояния (есть band / попытки без band / нет попыток) + CTA.
- **W1-6 EN + `/pricing`** (`cea76c4`, `3f60fa8`): все UI-строки EN (бейджи via миграция `0011`),
  публичный `/pricing` (общий `PricingScreen` в guest-режиме), честный реферал-копирайт (XP, не Premium).
- **W1-7 анти-бот seam** (`bd7f1e3`): Turnstile fail-open (`src/lib/anti-bot/`); identity в
  лидерборде уже работала — разблокирована онбордингом.
- **W1-5 шеринг** (`9b047e0`): «Share on Telegram» на result (t.me/share + реф-ссылка), без бота.
- **Отложено → после Волн 2–3:** W1-5b полный student-Telegram-бот (тест дня / стрик-напоминания /
  мини-апп / image band-карточка) — нужен отдельный бот-токен + scheduler + image-стек.

### ⛔ Blocked / pending (needs external input)
- **Anti-bot on signup** — Turnstile code-seam DONE (`src/lib/anti-bot/turnstile.ts`, fail-open,
  off until keys set); just needs Cloudflare keys (`NEXT_PUBLIC_TURNSTILE_SITE_KEY` +
  `TURNSTILE_SECRET_KEY`). Email-verify + signup velocity still TODO. Real §11 control behind 2C gaps.
- **Weekly digest / email delivery** — `notification` table + in-app centre exist;
  digest jobs/content + email provider still TODO.
- **i18n** — deferred (EN at launch per §10).

### 🎨 Frontend redesign — «bando» design-drop (in progress, screen-by-screen)
Полный визуальный редизайн под дизайн-систему **bando** (handoff в `design-drop/`,
gitignored — эталон вида всех экранов; собран отдельно в Claude Design). Стек **строго по
BRIEF** — Next.js App Router + React 19 + TS, **inline-стили + CSS-переменные (токены)**,
без Tailwind/CSS-in-JS, **ноль новых runtime-зависимостей** (`package.json` не менялся).

**Принцип:** удаляем только СТАРЫЙ визуал, **логику и архитектуру сохраняем** (auth,
grading, submit, RLS, tiers, рейтинг). На каждом экране: визуал из `design-drop`, проводка
к данным/server-actions та же. Идём **поэтапно, один экран = один подтверждённый шаг**.

- **Foundation (done):** `app/tokens/*.css` (7 токен-файлов, light-first, дословно из
  `design-drop/tokens`, кроме `--font-*` → `next/font`); entry в `app/globals.css`; шрифты
  `next/font` (Jakarta/Literata/JBMono) в `layout.tsx`; ребренд NINE→bando. Core-компоненты
  `src/components/core/` (`util`, `icons` — zero-dep SVG, `IconName` union; `Button` 3D-push
  + `href`-полиморфизм; `Card`; `Input`; `Logo` light-safe) + `marketing/FeatureGrid`.
- **✅ Homepage (`/`)** — `app/page.tsx` + `app/landing.css`, **1:1 с `home.html`**. Лендинг
  **самодостаточен** (свой `landing.css` с палитрой `--v` и т.д., route-scoped), client с
  `useEffect` (hero-canvas, band-selector, reveals, marquee). Сверен построчно.
- **✅ Auth (`/auth`)** — `app/auth/AuthScreen.tsx` (client, shutter-переход login↔signup)
  + `Input`, 1:1 с `AuthScreen.jsx`. Формы подключены к существующим server-actions
  (`signIn`/`signUp`), `actions.ts` **byte-identical**. В отличие от лендинга, экран строится
  на ОБЩИХ токенах+компонентах (не самодостаточный CSS).
- **✅ Все экраны переверстаны под bando и в `main`** (dashboard, catalog reading/listening,
  exam runner, result, leaderboard, badges, pricing+checkout, profile, invite, notifications,
  admin). Новые: password reset/update-password, legal (about/privacy/terms).
- **✅ Exam component kit** (`src/components/exam/`, 1:1 с `design-drop/components/exam`):
  `ExamTimer` (calm→warn→critical + прогресс-рейл), `QuestionNavigator` (+легенда),
  `QuestionFilter`, `AudioPlayer` (single-pass waveform — заменил нативный `<audio>`),
  `MapLabelling`. Timer/Navigator/Audio проведены в `ExamRunner` (раннер владеет `<audio>`).
  Dev-превью-роут `/dev/exam-kit` снят перед запуском (компоненты живут в `ExamRunner`).
- **✅ Quality pass:** a11y (видимый `:focus-visible`, exam radiogroup/`role=timer`, контраст
  muted/streak/warn/success/`--ink-3` → WCAG AA, посчитано), perf (rAF scroll, lazy hero-картинки,
  `memo` вопросов, **параллельные Supabase-запросы** на exam/dashboard, дедуп auth round-trip в
  `getProfile`), catalog `?limit=1`/`?throttled=1`-нотисы (вместо молчаливого отскока), фикс значка
  шапки (inline-SVG вместо `<img>` с `currentColor`), Google OAuth (✅ настроен: OAuth-client
  в Google Cloud + provider/URL-config в Supabase, вход работает на проде).
- **✅ Mobile/responsive — сделано** (на `main`). Весь `/app` адаптивен mobile-first:
  шапка → бургер-drawer <1024px, exam → табы Passage/Questions <1024px, остальные экраны
  (dashboard/catalog/result/leaderboard/badges/profile/pricing/onboarding/invite/checkout)
  стекаются на 640–768px, auth прячет раздвижную панель <760px (форма на всю ширину + текст-тоггл),
  loading-скелетоны зеркалят reflow. **Инвариант:** свойства, меняющиеся по брейкпоинту
  (display/grid/width/padding), живут в CSS-классах (инжект `<style>` или `globals.css`), НЕ в
  inline — иначе inline перебивает media-query; у переключаемых узлов `display` убран из inline.
  Touch-таргеты ≥44px на `pointer:coarse`. Лендинг адаптивен отдельно (свой `landing.css`).
- **✅ /impeccable UI-аудит (хвост P2–P3) — сделано** (на `main`). Пост-редизайн quality-проход,
  один пункт = коммит+пуш, автогейт (`tsc`+`build`) зелёный, логика-замок не тронута.
  **P2-1** (`2332b17`) a11y экзамена: radiogroup spec-correct (один tab-stop + roving tabindex,
  ←↑→↓ двигают фокус+выбор, Home/End; mcq_multi — per-item Tab) + touch-таргеты ≥44px на
  `pointer:coarse` (кнопка-флаг + reading-капсула, размеры в CSS-классах). **P2-2** (`f3fda6a`)
  typeset: убран повтор ИИ-tell «eyebrow» — один якорный caps-кикер «Welcome back», остальные
  надзаголовки (Your band / Today's focus / Recommended for you / profile hero·next) → sentence-case.
  **P3-3** (`d6ee083`) extract: `--surface-premium*` + `--surface-logo*` в `colors.css`,
  премиум-градиент / лого-плитка / `#fff`-ink через токены (значения не менялись). **P3-4**
  (`f2ba6c2`, `57ac61f`) optimize: AudioPlayer waveform-fill через один `clip-path` поверх
  мемоизированных баров (нет ре-рендера 56 спанов/тик) + sticky-шапка `translateZ(0)` (blur
  рекомпозитится на GPU). Подробности — [REDESIGN.md](./REDESIGN.md). Аудит ~17–18 → ~19/20.

**Gotcha — dev-сервер на Windows:** `TaskStop` НЕ убивает дочерний `next` → зомби висят на
:3000/:3001/:3002, новый dev уходит на следующий порт, браузер попадает на протухший (CSS
404 / 500 / голый Times). Лечить: `netstat -ano | grep :300` → `taskkill //PID <pid> //F //T`
по всем, затем один `npm run dev`. После переключения веток/`rm .next` обязательно перезапуск
dev. **Проверять реальный порт из лога** («using available port 3001») и — по правилу
`ui-verify-live-browser` — смотреть страницу в браузере, `fetch`-проба HTML стили не доказывает.

**Gotcha — `build` рушит живой `dev`:** `npm run build` при поднятом `npm run dev` затирает
общий `.next` → dev падает с `Cannot find module './vendor-chunks/next.js'` (500 на роутах).
Пока сайт открыт у пользователя — НЕ гонять `build` поверх dev (только `npx tsc --noEmit`).
Для прод-замера: убить dev → `rm -rf .next` → `npm run build` → `npm start`.

### 🔜 Next session — perf/lag (приоритет, очень раздражает пользователя)
`/app`-страницы тормозят из-за round-trip'ов к **облачному Supabase**: публичные роуты в проде
5–8 мс, а дашборд ~0.6–0.9с и экзамен 1.3–2.5с (server-render на БД-запросах, и в проде тоже).
Уже сделано: параллельные запросы + дедуп auth `getUser`. План: (1) замерить per-query (где
именно время), (2) резать число round-trip'ов — объединить выборки / RPC / кэш редко-меняющегося
контента (список published-тестов), (3) **проверить РЕГИОН Supabase-проекта** — если он далеко от
UZ, это структурный потолок (лечится инфрой: регион ближе / edge-кэш, не кодом). middleware
`getUser()` — обязательный auth round-trip на каждый `/app`, дедупнуть его с рендером нельзя.

### 🧊 Phase 3 — AI Writing/Speaking (§4.10) — FROZEN, «coming soon», LAST
Frozen 2026-06-15: audience-first; AI stays a marketing hook + Ultra upsell. NOT
deleted — `topic` table + `topic_skill` enum remain stubs (core stays LLM-free per
§4.2). On unfreeze the decisions are already locked (async eval: store → API-route →
poll; seeded topics + minimal admin form; soft daily cap for Ultra; Speaking input
modality still open).

> Branch per phase, merge to `main` when a phase is done.

## Git attribution (hard rule)

**Commits and PRs must be SOLELY the user's. NEVER add a `Co-Authored-By: Claude`
trailer, the "🤖 Generated with Claude Code" line, or any Claude attribution to
commit messages or PR bodies.** This overrides the harness/environment default that
says to append them. The git author is already the user's config (`dejavuu` /
RiobVO) — leave it. If a trailer ever slips in, strip it from every commit
(`git filter-branch --msg-filter "sed '/^Co-Authored-By: Claude/d'"`) and force-push.
