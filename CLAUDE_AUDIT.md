# CLAUDE_AUDIT.md — широкий аудит для Claude Code (2026-06-25)

Этот документ — рабочая карта для Claude Code по свежему широкому инженерно-продуктовому аудиту IELTS-платформы.
Он дополняет `AUDIT.md`: старый файл сохраняет историю закрытого аудита 2026-06-24, а этот файл фиксирует новые
открытые находки, отложенные решения, которые нужно довести, и порядок безопасной доработки.

Важно: это не кодовый diff и не план автоматического рефакторинга. Перед любой правкой Claude Code обязан заново
проверить актуальные строки в текущем checkout, потому что `file:line` ниже являются снимком на 2026-06-25.

## Прогресс закрытия (2026-06-25)

Закрыто и на `main` (verify + tsc + build + tests зелёные):

- ✅ P1 auth open-redirect → `safeNextPath` в form-action и OAuth-callback (commit `05fc612`).
- ✅ P1 too-fast в weekly/monthly leaderboard → floor-guard тем же предикатом, что и Elo; без миграции (commit `5de6198`).
- ✅ P2 OAuth/Google drift → `google` в enum (migration `0018`) + trigger-clamp + analytics-тип + OAuth-signup в воронку (commit `3c8f5a9`).
- ✅ P3 Basic daily-limit doc drift → `SCHEMA_NOTES`/`LAUNCH` синхронизированы с `BASIC_DAILY_LIMIT=25` (commit `7cfe5ca`).
- ✅ P1 admin publish review gate → parser warnings + `content_item.reviewed_at`/`import_warnings` (migration `0019`) + Approve-перед-Publish с серверным enforcement (commits `af20b55`, `e28e4fb`, `2185269`).

- ✅ P3 invite Host header → invite URL якорится на `NEXT_PUBLIC_SITE_URL` (validated origin) с fallback на host (commit `c72cbfe`).
- ✅ P2 pending payments expiry → `payment.expires_at` (migration `0020`) + TTL на initiate + отклонение устаревшего pending в webhook (outcome `expired`); applied-replay остаётся идемпотентным (commit `91cbb94`).

Раздел «Открытые находки» (P1–P3): закрыт полностью.

Раздел «Осознанно отложенное» (D1–D5) — статус (решения 2026-06-25):

- ⛔ D1 provider-specific payment signatures → BLOCKED-external (решение: провайдеры ещё не подключены). Нужны схемы подписи + sandbox-ключи Payme/Click/Uzum; до онбординга placeholder fail-closed в проде (доступ не выдаёт) — безопасен.
- 🟡 D2 anti-bot/email-verify/referral farming → captchaToken УЖЕ подключён (`app/auth/actions.ts:34-37`, проверено — claim `SCHEMA_NOTES:246` устарел). Остаётся: signup velocity-cap (нужна IP-инфра) + порог referral-награды (мелкое продуктовое). Активация Turnstile ждёт Cloudflare-ключей (fail-open).
- 🟠 D3 result snapshot/regrade → доступно кодом, НО security-sensitive: snapshot должен быть SERVER-ONLY (отдельная RLS-locked таблица / revoke column-grant), иначе client-read через owner-RLS `attempt` утечёт gated answer_key/evidence basic-юзеру (регресс инварианта). Делать отдельным выверенным проходом + verify-тест на отсутствие client-утечки. Не сделано.
- 🤝 D4 full review free → РЕШЕНО: пересмотр на Wave 2 pricing (с retention/conversion-данными). Сейчас `REVIEW_OPEN=true` остаётся. Кода не требует.
- 🧊 D5 AI Phase 3 → РЕШЕНО: остаётся frozen (§4.2 LLM-free core; CLAUDE.md FROZEN/LAST). Не баг, осознанный трек.

Деплой: применить миграции к Supabase (`npm run db:migrate`) — `0018` (google в enum) и `0019` (review-gate колонки). Код
обратно совместим: прод не падает без них (google сохраняется как `email`, а publish работает по-старому), но фичи
включаются только после применения.

## Как пользоваться

1. Сначала прочитать `BRIEF.md`, затем `CLAUDE.md`, `BACKLOG.md`, `SCHEMA_NOTES.md`, `REDESIGN.md`.
2. Сверить, что пункт не является accepted gap / deferred / frozen решением.
3. Перед исправлением открыть указанные файлы и подтвердить, что проблема всё ещё существует.
4. Для задач с БД держать `src/db/schema.ts`, `migrations/NNNN_*/up.sql`, `migrations/NNNN_*/down.sql` и `scripts/verify.ts` в lockstep.
5. После исправления прогнать минимум релевантную проверку:
   - `npm run verify` для RLS/миграций/DB contract;
   - `npx tsc --noEmit` для TypeScript;
   - `npm test` для unit-тестов;
   - `npm run build` для Next.js build graph.

Если задача связана только с документацией, достаточно детерминированной проверки наличия нужных секций. Если задача
трогает payment/auth/RLS/grading/leaderboard, одной проверки типов недостаточно.

## Карта состояния проекта

### Сделано и подтверждено документами

- Phase 0/1/2, launch hardening, Wave 1 и frontend redesign отмечены как done в `CLAUDE.md:144`.
- Два DB-пути являются частью security model: Supabase client под RLS и Drizzle owner-path для grading/import, см. `CLAUDE.md:39`.
- `answer_key` не должен попадать клиенту до submit; это зафиксировано как инвариант в `CLAUDE.md:51`.
- Import pipeline должен оставаться deterministic, без LLM и без `eval` в бизнес-логике, см. `CLAUDE.md:112`.
- Phase 3 AI заморожен и остаётся "coming soon", см. `CLAUDE.md:187`.

### Осознанно отложено, не считать багом без нового основания

- Multi-account referral farming принят как gap до отдельного anti-bot milestone: `SCHEMA_NOTES.md:242`.
- Referral reward после любого submitted теста, даже 0-score, является deferred product choice: `SCHEMA_NOTES.md:262`.
- Basic daily-limit TOCTOU принят как soft monetization gap: `SCHEMA_NOTES.md:339`.
- HMAC-подпись payment webhook является provider-specific placeholder до merchant onboarding: `SCHEMA_NOTES.md:310`.
- Full result review сейчас открыт как monetization policy, а не забытый paywall: `REDESIGN.md:32`.

## Итог свежего аудита

P0 не найден. Ядро выглядит сильным: RLS/answer_key lockdown, owner-path, server-side grading, submit idempotency и
многие launch-hardening решения уже закрыты. Основной риск сместился из "дыр в фундаменте" в интеграционные края:
leaderboard recompute, admin content QA, auth redirect normalization, OAuth contract и payment lifecycle.

Главный порядок доработки:

1. Закрыть auth open-redirect риск через нормализацию `next`.
2. Закрыть admin publish gate для answer keys/warnings.
3. Закрыть too-fast leakage в weekly/monthly leaderboard.
4. Синхронизировать OAuth contract между брифом, UI, schema и analytics.
5. Добавить expiry/reconciliation для pending payments.
6. Перед реальными платежами и ростом поднять deferred blockers: provider signatures, anti-bot/referral farming, result snapshot.

## Открытые находки

### P1 — too-fast попытки могут попасть в weekly/monthly leaderboard

Статус: closed — commit `5de6198` (2026-06-25). Light-fix без миграции: тот же `isTooFastToRate` применён в recompute.
Тип: risk.
Усилие: M.

Что найдено:
too-fast first submit исключается из Elo через `rated=false`, но этот факт не сохраняется в `attempt`. Позже leaderboard
recompute строит weekly/monthly snapshots по всем `submitted` first attempts и не повторяет time-floor predicate.

Почему важно:
это не ломает деньги и не раскрывает данные, но бьёт по integrity leaderboard. Пользователь или бот может мгновенно
сдать тест, не получить Elo, но всё равно попасть в weekly/monthly leaderboard при последующем recompute.

Доказательство:

- `src/lib/progress/apply-post-submit.ts:123` — `rated` отключается для too-fast.
- `app/app/reading/[id]/actions.ts:203` — recompute после submit вызывается только для текущего `post.rated`.
- `src/lib/progress/leaderboard.ts:175` — first-attempt выборка берёт `submitted` attempts.
- `src/lib/progress/leaderboard.ts:186` — score агрегируется из выбранных attempts.
- `src/lib/progress/leaderboard.ts:211` — weekly/monthly eligibility основана на score, не на anti-cheat verdict.

Что сделать:

- Добавить durable поле вроде `rated` / `excluded_reason` / `anti_cheat_verdict` на `attempt`, либо повторять тот же
  `isTooFastToRate(time_used_seconds, total_questions)` predicate в leaderboard query.
- Предпочтительнее durable verdict: он делает intent видимым для аналитики, админки и будущих leaderboard jobs.
- Добавить unit/integration regression: too-fast first attempt не влияет на Elo и не попадает в weekly/monthly snapshot.

Проверка после исправления:

- `npm run verify`
- `npx tsc --noEmit`
- `npm test`

### P1 — admin publish не подтверждает качество answer keys перед публикацией

Статус: closed — commits `af20b55`/`e28e4fb`/`2185269` (2026-06-25). Parser warnings + `reviewed_at`/`import_warnings` (migration `0019`) + Approve-перед-Publish с серверным enforcement.
Тип: gap.
Усилие: M.

Что найдено:
бриф требует review screen и обязательное подтверждение ключа админом, но текущий admin flow показывает upload/list/publish.
Runner import возвращает только количество warnings, parser местами fallback-ит question type без surfaced warning details.

Почему важно:
неверный `answer_key` или `question_type` после publish превращается в системную ошибку grading для всех пользователей.
Это content-quality risk с прямым влиянием на доверие к IELTS scoring.

Доказательство:

- `BRIEF.md:151` — admin upload должен извлекать content/key/types.
- `BRIEF.md:156` — админ обязан подтвердить ключ.
- `app/admin/page.tsx:56` — upload form.
- `app/admin/page.tsx:83` — publish action в списке content items.
- `app/admin/actions.ts:71` — `setStatus` меняет status без review precondition.
- `src/lib/import/runner/import-runner.ts:64` — в результат уходит только `warnings: parsed.warnings.length`.
- `src/lib/import/runner/parse-runner.ts:58` — fallback на `short_answer`.
- `src/lib/import/runner/parse-runner.ts:76` — warnings возвращаются пустыми.

Что сделать:

- Ввести review gate между import и publish.
- На review экране показывать parsed question count, answer key count, unknown/fallback qtypes, warnings, missing evidence/explanations.
- Publish разрешать только после explicit confirmation.
- Parser должен возвращать детальные warnings, а не только count.

Проверка после исправления:

- `npm test` для parser/import logic.
- `npx tsc --noEmit`.
- Точечный тест на fixture с unknown qtype: warning виден, publish без confirmation невозможен.

### P1 — `next` в auth flow не валидируется как локальный путь

Статус: closed — commit `05fc612` (2026-06-25). `safeNextPath` в `actions.ts` + `callback/route.ts`, unit-тесты.
Тип: risk.
Усилие: S.

Что найдено:
query/form `next` проходит из `/auth` в server action и используется в `redirect(next)` без локальной нормализации.

Почему важно:
это open-redirect риск после настоящего логина. Даже без account takeover такой redirect полезен для phishing flow:
пользователь проходит легитимную авторизацию, потом его уводят на внешний URL.

Доказательство:

- `app/auth/page.tsx:21` — `sp.next` передаётся в `AuthScreen`.
- `app/auth/AuthScreen.tsx:199` — hidden input отправляет `next`.
- `app/auth/actions.ts:16` — server action читает `next` из form data.
- `app/auth/actions.ts:23` — `redirect(next)` без проверки.
- `app/auth/callback/route.ts:11` — callback тоже принимает `next`.

Что сделать:

- Ввести helper `safeNextPath(value): string`.
- Разрешать только internal path, начинающийся с одного `/`.
- Запрещать `//`, absolute schemes (`https:`, `javascript:`), backslashes, control chars.
- Default fallback: `/app`.

Проверка после исправления:

- Unit-тесты на `safeNextPath`.
- `npx tsc --noEmit`.

### P2 — OAuth contract расходится между брифом, UI, schema и analytics

Статус: closed — commit `3c8f5a9` (2026-06-25). Решение: Google = launch-провайдер; добавлен в enum/trigger/analytics + OAuth-signup capture. Apple/Facebook и OAuth-referral остаются отдельными gap.
Тип: drift.
Усилие: M.

Что найдено:
бриф говорит Email/Apple/Facebook. UI предлагает Google. DB enum не содержит Google. Auth trigger для неизвестного provider
схлопывает значение в `email`. Signup analytics типизирована только под email/apple/facebook, а OAuth signup event отдельно
не фиксируется.

Почему важно:
это ломает продуктовую аналитику и источник правды по auth providers. Google-пользователи могут быть записаны как email,
а обещанные Apple/Facebook не видны в UI.

Доказательство:

- `BRIEF.md:174` — регистрация: Email, Apple OAuth, Facebook OAuth.
- `src/db/schema.ts:41` — enum `auth_provider` без Google.
- `migrations/0005_referral_linking/up.sql:23` — unknown provider fallback.
- `app/auth/AuthScreen.tsx:70` — Google OAuth button.
- `src/lib/analytics/events.ts:19` — analytics type без Google.
- `app/auth/actions.ts:57` — signup analytics есть для email/password flow.

Что сделать:

- Принять одно решение: либо Google является launch provider, либо нет.
- Если Google остаётся: добавить `google` в enum/migrations/schema/analytics/docs и корректно обрабатывать OAuth signup attribution.
- Если Google не нужен: убрать Google button и реализовать Apple/Facebook согласно брифу.

Проверка после исправления:

- `npm run verify` при изменении enum/trigger.
- `npx tsc --noEmit`.
- Тест/ручная проверка OAuth callback analytics path.

### P2 — pending payments не имеют срока жизни

Статус: closed — commit `91cbb94` (2026-06-25). `payment.expires_at` (migration `0020`) + TTL на initiate + отклонение устаревшего pending в webhook (`expired` → 'failed', доступ не выдан); applied-replay идемпотентен.
Тип: improvement.
Усилие: M.

Что найдено:
checkout создаёт `pending` payment без expiry. `applyCompletedPayment` принимает любую не-completed строку по
`providerTransactionId`, если она всё ещё совпадает с catalog plan.

Почему важно:
старые abandoned checkout rows остаются применимыми бессрочно. Это усложняет provider reconciliation, retries, fraud review
и поддержку пользователей.

Доказательство:

- `app/app/upgrade/actions.ts:42` — создаётся `payment` row.
- `app/app/upgrade/actions.ts:52` — status выставляется `pending`.
- `src/db/schema.ts:521` — таблица `payment`.
- `src/db/schema.ts:535` — status.
- `src/db/schema.ts:537` — есть `createdAt`, но нет `expiresAt`.
- `src/lib/payments/index.ts:106` — lookup pending/completed row по provider tx.
- `src/lib/payments/index.ts:123` — `not_found` только если row нет.
- `src/lib/payments/index.ts:124` — duplicate только если уже `completed`.

Что сделать:

- Добавить `expires_at` или вычисляемый TTL policy для `pending`.
- В webhook path отклонять stale pending rows или переводить их в `failed/expired`.
- TTL должен соответствовать реальным правилам Payme/Click/Uzum, а не произвольной цифре.

Проверка после исправления:

- `npm run verify`.
- Unit/integration тесты: active pending applies, stale pending rejects, duplicate completed remains idempotent.

### P3 — Basic daily-limit drift между документацией и кодом

Статус: closed — commit `7cfe5ca` (2026-06-25). 25 — осознанная launch-настройка; docs синхронизированы с кодом.
Тип: drift.
Усилие: S.

Что найдено:
`SCHEMA_NOTES.md` говорит, что Basic daily limit равен 3, а код выставляет 25.

Почему важно:
это не runtime bug, но сбивает Claude Code и владельца продукта при работе над monetization gates.

Доказательство:

- `SCHEMA_NOTES.md:295` — описывает `BASIC_DAILY_LIMIT=3`.
- `src/lib/tiers.ts:11` — фактический limit равен 25.

Что сделать:

- Обновить `SCHEMA_NOTES.md`, если 25 — осознанная launch-настройка.
- Или вернуть/параметризовать лимит, если 3 — актуальный продуктовый контракт.

Проверка после исправления:

- Документная проверка grep/Select-String на единое значение.

### P3 — invite URL строится из входящего `Host` header

Статус: closed — commit `c72cbfe` (2026-06-25). invite URL предпочитает `NEXT_PUBLIC_SITE_URL` (validated origin), fallback на host только без env.
Тип: risk.
Усилие: S.

Что найдено:
страница invite строит absolute URL из `headers().get("host")`. В нормальном Vercel/proxy окружении Host обычно
валидируется платформой, поэтому это не доказанный exploit без runtime-проверки. Но код доверяет входящему host.

Почему важно:
referral/invite ссылки могут указывать на неправильный или spoofed домен при нестандартной proxy/host конфигурации.

Доказательство:

- `app/app/invite/page.tsx:23` — чтение `host` из request headers.
- `app/app/invite/page.tsx:26` — сборка absolute invite URL.

Что сделать:

- Строить public URL от валидированного `NEXT_PUBLIC_SITE_URL` / `APP_URL`.
- Либо ввести allowlist доменов и fallback.

Проверка после исправления:

- Unit-тест helper-а public URL.
- `npx tsc --noEmit`.

## Осознанно отложенное, которое нужно доработать

Эти пункты не являются "забытыми багами": они задокументированы как deferred/accepted/frozen. Но перед запуском денег,
ростом трафика или масштабированием content ops их нужно поднять в план.

### D1 — provider-specific payment signature

Статус: accepted gap, но launch-blocker перед реальными платежами.
Приоритет пересмотра: высокий.
Усилие: M/L, зависит от провайдеров.

Почему отложено:
merchant keys и реальные схемы Payme/Click/Uzum ещё не подключены. Сейчас есть fail-closed guard для production без ключа
и placeholder HMAC path.

Доказательство:

- `SCHEMA_NOTES.md:310` — payment secret может отсутствовать до merchant key.
- `SCHEMA_NOTES.md:314` — HMAC path является placeholder.
- `SCHEMA_NOTES.md:339` — HMAC placeholder listed as accepted gap.
- `src/lib/payments/index.ts:75` — generic HMAC-SHA256 placeholder.

Что нужно доработать:

- Реализовать provider-specific verification для каждого подключённого провайдера.
- Проверять raw body/headers ровно по документации провайдера.
- Сохранить invariant: entitlement берётся только из trusted pending row, не из webhook body.
- Добавить forged webhook regression для каждого provider.

Не делать:

- Не принимать tier/userId/amount из тела webhook как trusted values.
- Не включать stub signature в production.

### D2 — anti-bot, email verification и referral farming

Статус: accepted gap.
Приоритет пересмотра: высокий перед growth/referral launch.
Усилие: M/L.

Почему отложено:
Turnstile seam есть, но ключей и полного signup anti-abuse flow нет. Multi-account farming явно принят как gap.

Доказательство:

- `SCHEMA_NOTES.md:242` — multi-account farming не защищён migration `0005`.
- `SCHEMA_NOTES.md:244` — real control должен быть Turnstile/captcha + email-confirm + velocity cap.
- `SCHEMA_NOTES.md:246` — `app/auth/actions.ts` ещё не передаёт `captchaToken`.
- `CLAUDE.md:168` — anti-bot signup blocked/pending external input.
- `src/lib/anti-bot/turnstile.ts:15` — fail-open без configured keys.

Что нужно доработать:

- Включить Turnstile на signup и, при необходимости, на referral-sensitive paths.
- Добавить email verification policy.
- Добавить per-inviter velocity cap и/или reward threshold.
- Пересмотреть referral reward: "любой submitted тест" против `rated`/`rawScore > 0`.

Не делать:

- Не считать referral XP/leaderboard без abuse model, если начинается paid acquisition.

### D3 — result snapshot / regrade consistency

Статус: deferred.
Приоритет пересмотра: средний сейчас, высокий перед активным content ops.
Усилие: M/L.

Почему отложено:
пока контент меняется редко, result page может пересчитывать review из текущего `answer_key`. Full regrade/snapshot вынесен
в backlog.

Доказательство:

- `BACKLOG.md:160` — full regrade/review snapshot отложен.
- `app/app/reading/[id]/result/page.tsx:182` — result/review читает текущий `answer_key`.

Что нужно доработать:

- При submit сохранять snapshot достаточный для стабильного review: normalized correct answers, explanations/evidence version,
  parser/content version или immutable answer-key revision.
- Для исправлений published content добавить regrade flow с явным user-facing статусом.

Не делать:

- Не менять старые результаты молча при правке ключа без audit trail.

### D4 — full review free для всех тарифов

Статус: осознанная monetization policy.
Приоритет пересмотра: средний, зависит от pricing experiments.
Усилие: S/M.

Почему отложено:
редизайн сознательно открыл full review как value moment, а не как забытый paywall.

Доказательство:

- `REDESIGN.md:32` — policy: full result review open/free now.
- `src/lib/tiers.ts:45` — review flag seam.
- `app/app/reading/[id]/result/page.tsx:285` — result page использует review-open policy.

Что нужно доработать:

- Перед Wave 2 pricing решить, что именно монетизируется: daily limit, full mocks, detailed explanations, analytics history,
  AI tutor или full review.
- Если review снова gated, сохранить серверный invariant: закрытые explanations/evidence не должны попадать в client tree.

Не делать:

- Не закрывать review преждевременно без retention/conversion данных: для IELTS это главный value moment.

### D5 — AI Phase 3

Статус: frozen, coming soon.
Приоритет пересмотра: низкий до стабилизации Reading/Listening и monetization.
Усилие: L.

Почему отложено:
ядро grading/import должно оставаться deterministic. AI разрешён как будущий tutor/explanation/upsell слой, но не как
authoritative scoring/import.

Доказательство:

- `CLAUDE.md:187` — Phase 3 frozen.
- `CLAUDE.md:188` — AI остаётся marketing hook + Ultra upsell.
- `CLAUDE.md:189` — core stays LLM-free.
- `CLAUDE.md:190` — async eval decisions locked only on unfreeze.

Что нужно доработать:

- При разморозке держать AI асинхронным и не блокировать deterministic exam flow.
- Не использовать LLM для authoritative import/grading.
- Начать с tutor-mode/explanations/speaking-writing feedback, где недетерминизм не ломает core score.

## Что важно из первого аудита

Старый `AUDIT.md` не нужно удалять: он хранит историю закрытых проблем и проверенных решений. Для Claude Code это
важно как список вещей, которые нельзя случайно откатить.

Ключевые закрытые пункты первого/предыдущего аудита:

- P0 iframe isolation: `runner_html` раньше исполнялся same-origin; закрыто opaque-origin sandbox. См. `AUDIT.md:124`, `AUDIT.md:131`.
- Malformed UUID в owner-path давал 500 вместо 404; закрыто UUID guard-ом. См. `AUDIT.md:45`, `AUDIT.md:55`.
- Too-fast submit для Elo был закрыт floor-guard-ом. См. `AUDIT.md:61`, `AUDIT.md:65`.
- Percentile раньше считал все attempts и самого пользователя; закрыто first-attempt-per-other-user logic. См. `AUDIT.md:72`, `AUDIT.md:76`.
- Telegram audio мог привязаться к последнему Listening тесту; закрыто выбором newest listening needing audio. См. `AUDIT.md:81`, `AUDIT.md:85`.
- Draft test был доступен по прямому owner-path `/app/exam/:id`; закрыто `status='published'` checks. См. `AUDIT.md:110`, `AUDIT.md:118`.
- Документация `CLAUDE.md` была обновлена после старого drift. См. `AUDIT.md:163`, `AUDIT.md:167`.

Важное уточнение:
старый пункт "too-fast submit закрыт" касался Elo/rating path. Свежая находка 2026-06-25 не противоречит ему: новый gap
про weekly/monthly leaderboard recompute, где durable anti-cheat verdict не хранится и не применяется.

## Guardrails для Claude Code при исправлениях

- Не трогать Phase 3 AI, если задача не говорит явно размораживать его.
- Не тащить LLM в import/grading.
- Не читать `answer_key` через клиентский Supabase path.
- Не расширять Drizzle owner-path на user-facing reads без отдельного auth/ownership/status gate.
- Не менять RLS/migrations без `scripts/verify.ts` regression.
- Не полагаться на page-level gate: submit/server action должен повторять tier/auth/integrity checks.
- Не считать документацию источником runtime-фактов: production DB, env, provider dashboards и logs нужно проверять отдельно.

## Рекомендуемый порядок задач

### Task A — safe auth redirect

Файлы-кандидаты:

- `app/auth/actions.ts`
- `app/auth/callback/route.ts`
- возможно новый маленький helper в `src/lib/auth/` или рядом с auth route.

Acceptance:

- `/auth?next=/app/reading` ведёт внутрь приложения.
- `/auth?next=https://evil.example` ведёт на `/app`.
- `/auth?next=//evil.example` ведёт на `/app`.
- callback flow использует тот же sanitizer.

Verification:

- `npx tsc --noEmit`
- unit-тест helper-а, если в проекте есть подходящее место.

### Task B — admin import review gate

Файлы-кандидаты:

- `app/admin/page.tsx`
- `app/admin/actions.ts`
- `src/lib/import/runner/import-runner.ts`
- `src/lib/import/runner/parse-runner.ts`
- parser tests/fixtures.

Acceptance:

- Draft after import cannot be published until review confirmation.
- Unknown/fallback question type visible as warning.
- Missing/partial key visible as warning/error.
- Publish action checks precondition server-side, not only UI.

Verification:

- `npm test`
- `npx tsc --noEmit`
- если schema меняется, `npm run verify`.

### Task C — durable anti-cheat verdict for leaderboard

Файлы-кандидаты:

- `src/db/schema.ts`
- `migrations/NNNN_*`
- `src/lib/progress/apply-post-submit.ts`
- `src/lib/progress/leaderboard.ts`
- `scripts/verify.ts`
- progress/leaderboard tests.

Acceptance:

- Too-fast first attempt excluded from Elo and period leaderboards.
- Normal first attempt still counts.
- Retakes remain outside first-attempt leaderboard semantics.
- Existing historical rows have deterministic backfill/default policy.

Verification:

- `npm run verify`
- `npm test`
- `npx tsc --noEmit`

### Task D — OAuth contract cleanup

Файлы-кандидаты:

- `BRIEF.md`
- `src/db/schema.ts`
- `migrations/NNNN_*`
- `app/auth/AuthScreen.tsx`
- `app/auth/actions.ts`
- `app/auth/callback/route.ts`
- `src/lib/analytics/events.ts`

Acceptance:

- UI providers match documented launch providers.
- DB enum and auth trigger store provider accurately.
- Signup analytics captures OAuth providers accurately.
- Referral metadata still works through OAuth/signup.

Verification:

- `npm run verify`
- `npx tsc --noEmit`
- OAuth smoke check in dev/staging.

### Task E — payment pending expiry

Файлы-кандидаты:

- `src/db/schema.ts`
- `migrations/NNNN_*`
- `app/app/upgrade/actions.ts`
- `src/lib/payments/index.ts`
- webhook route/tests.

Acceptance:

- Pending payments have explicit expiry.
- Active pending can complete.
- Stale pending cannot grant entitlement.
- Completed replay remains idempotent.

Verification:

- `npm run verify`
- `npm test`
- `npx tsc --noEmit`

## Границы свежего аудита

- Аудит был статический: production Supabase, env vars, provider dashboards, prod logs и реальные webhook deliveries не проверялись.
- `npm run verify`, `npx tsc --noEmit`, `npm run build`, `npm test` не запускались в read-only аудите, потому что они могут создавать cache/build artifacts.
- Browser/mobile QA и Lighthouse не выполнялись.
- Все `file:line` — снимок текущего checkout на 2026-06-25; перед работой их нужно обновить по фактическому файлу.
