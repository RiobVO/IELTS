# Writing Lab (Task 2) — design spec

> Date: 2026-06-25 · Status: approved design, pre-plan · Phase 3 unfreeze (Writing only, iteration 1)

## Контекст и цель

Разморозка Phase 3 (была FROZEN, BRIEF §4.10). Реализуем **AI Writing Lab** — режим, где AI
работает как тренер/диагност, а не как авторитетный экзаменатор. Первая итерация — **только IELTS
Writing Task 2 (essay)**, общий для Academic и General.

**Жёсткий инвариант (не обсуждается):** ядро Reading/Listening остаётся детерминированным и
**LLM-free** (BRIEF §4.2). AI живёт ТОЛЬКО в writing-слое, в отдельных таблицах, через отдельный
server-only вызов. Никакого контакта с R/L grading/import/answer_key.

## Scope

**В этой итерации:**
- Writing Task 2 essay (Academic + General — один формат).
- Async AI-оценка: band **range** + confidence + разбор по 4 IELTS-критериям + top-3 fixes +
  inline-аннотации + частичный rewrite + чек-лист к следующей попытке.
- Snapshot фидбека (стабильный — тот же разбор завтра, без пересчёта).
- Admin: minimal форма создания тем + publish-gate.

**Явные non-goals (НЕ делаем):**
- Authoritative/official band score. Только estimate-range (range + confidence). Internal
  accuracy-gate ±0.5 band — метрика выбора модели на бенчмарке, НЕ обещание точности юзеру.
- AI Task 1 (Academic vision + General letter) — **фаза 2** на общем каркасе.
- Speaking — **фаза 3** на общем каркасе.
- Leaderboard / сравнение юзеров по AI-оценке. Никакого «examiner-grade».
- LLM в Reading/Listening — навсегда нет.

## Архитектура — async (подход A)

```
[client]  POST essay
   → server action createWritingSubmission()
        - Ultra-gate (или free-preview-gate) + daily-cap
        - INSERT writing_submission (status='pending')
        - триггерит internal evaluate (fire-and-forget)
   → клиент поллит getSubmissionStatus(id)

[internal] POST /api/writing/evaluate  (internal-only, idempotent)
   - atomic claim: UPDATE ... SET status='evaluating' WHERE id=? AND status='pending' RETURNING
       · 0 строк → уже взято/завершено → no-op (идемпотентность)
   - evaluator.evaluate() — Gemini Flash via thin interface (см. «Evaluator: provider»), structured JSON output
   - INSERT writing_feedback (visible snapshot) + writing_feedback_debug (raw, server-only)
   - UPDATE writing_submission status='completed' (или 'failed' при ошибке)
   - инкремент preview-счётчика ТОЛЬКО при 'completed' для non-Ultra
```

**Почему async обязателен:** LLM-оценка эссе — десятки секунд, синхронный ответ упрётся в Vercel
function timeout и заморозит экран. Poll даёт честный «анализирую…» статус.

**`/api/writing/evaluate` — internal + idempotent:**
- Internal: вызывается только нашим server action; доказательство права — internal secret в header
  (паттерн `CRON_SECRET`). Юзер не может дёргать route напрямую (cost-abuse через токены).
- Idempotent: atomic status-claim `pending → evaluating` (single-fire, как `submitAttempt`).
  Повторный вызов на уже `evaluating/completed` → 0 строк claim → no-op. Дубль feedback невозможен.

**Reaper (stuck evaluating):** если route умер между claim и записью feedback, submission застрянет
в `evaluating`. Политика: `evaluating` старше N минут → `failed`, retry разрешён. Реализация — ленивый
reaper при чтении статуса или cron (решить в плане; cron-инфра уже есть — `expire-premium`).

## Data model (3 новые таблицы, R/L не трогаем)

Решение по `topic`-stub: **не reuse-аем**. `topic` (`id, skill, prompt, tier_required, created_at`)
слишком беден, а его «общность» (writing|speaking) обернётся семантически разными полями — Speaking
структурируется по Part 1/2/3, а не academic/general. Reuse сэкономил бы одну таблицу ценой смешанных
семантик. → отдельная `writing_task`; `topic`-stub оставляем как есть (Speaking-фаза решит сама).

**`writing_task`** — тема (admin-загружаемая):
- `id uuid pk`, `category enum(academic|general)`, `prompt text`, `tier_required user_tier`,
  `status enum(draft|published)`, `created_by uuid → profile`, `created_at`.
- RLS: `published` читается authenticated; draft — owner/admin only (urok P1 CLAUDE_AUDIT — publish
  подтверждает контент, не слепой flip).

**`writing_submission`** — попытка юзера:
- `id uuid pk`, `user_id uuid → profile`, `task_id uuid → writing_task`, `essay_text text`,
  `word_count int`, `status enum(pending|evaluating|completed|failed)`, `created_at`.
- RLS: owner-scoped (user_id = auth.uid()).

**`writing_feedback`** — снапшот разбора, видимый юзеру:
- `id uuid pk`, `submission_id uuid → writing_submission (unique)`, `band_low numeric`,
  `band_high numeric`, `confidence enum(low|medium|high)`, `criteria jsonb` (4 объекта: range /
  strength / main_issue / next_step), `top_fixes jsonb`, `annotations jsonb`, `rewrite jsonb`,
  `checklist jsonb`, `provider text`, `model text`, `prompt_version text`, `created_at`.
- RLS: owner-scoped через submission. **НЕ содержит raw.**

**`writing_feedback_debug`** — сырьё для калибровки/отладки, server-only:
- `id uuid pk`, `submission_id uuid`, `raw_output text`, `provider text`, `model text`,
  `prompt_version text`, `created_at`.
- RLS: enabled + all grants revoked from anon/authenticated (как `answer_key`). Только owner-path
  (Drizzle) читает. Причина: raw может нести prompt-leakage / внутренние рассуждения модели — не для
  клиента.

## Надёжность оценки (ядро качества)

- **Structured JSON output** по строгой схеме (zod/JSON-schema на входе в API). Форма ответа
  детерминирована, даже когда band плавает. Парсинг не «угадывает» — валидируется, при невалиде retry.
- **Rubric-промпт** по 4 официальным Task-2-дескрипторам: Task Response / Coherence & Cohesion /
  Lexical Resource / Grammatical Range & Accuracy. По каждому: range + 1 сильная + 1 главная проблема
  + next step.
- **Few-shot калибровка:** 1-2 эталонно-оценённых эссе в промпте (якорят шкалу). Источник эталонов —
  open question (см. ниже).
- **Band = range + confidence**, не точка. Low-confidence → мягче формулировки + явный дисклеймер
  «это ориентир, не официальный балл».
- **Доверие = прозрачность:** каждый вердикт по критерию привязан к конкретным местам эссе
  (аннотации), а не «чёрный ящик».
- `prompt_version` хранится в feedback — при правке промпта старые снапшоты остаются объяснимыми.

## Evaluator: provider (MVP — Gemini Flash only)

**MVP — один провайдер: Gemini Flash.** Никакого Claude API в первой итерации (минимальный
cost-surface, понятная unit economics). Конкретный id фиксируется бенчмарком (ниже).

**Тонкий internal interface.** Writing Lab зовёт один `Evaluator.evaluate(essay, task)` → строгая
JSON-схема feedback (контракт наш). Сейчас ровно ОДНА реализация (Gemini, structured output через
responseSchema). Interface существует НЕ ради мульти-провайдера сейчас, а чтобы позже добавить другого
провайдера/fallback без переписывания Writing Lab.

Конфиг через env (никаких хардкодов модели в коде):
- `WRITING_EVAL_MODEL` — id модели Gemini Flash (резолвится на бенчмарке).
- `GEMINI_API_KEY` — ключ провайдера.
- Provider в MVP НЕ env-переключаемый (одна реализация); мульти-provider env вводится вместе со вторым
  адаптером в будущей итерации.

**Без fallback в первой итерации.** Gemini вернул ошибку / timeout / невалидную по схеме (после
in-call retry) → submission `failed` (preview/cap НЕ списан, юзер ретраит). Второй провайдер —
будущая итерация через тот же interface. `provider` + `model` успешного прогона пишутся в
`writing_feedback` (+ debug) — снапшот объясним после смены модели.

**Осознанный trade-off:** single provider = один point of failure (Gemini down → оценка недоступна,
retry). Приемлемо для MVP ради cost-surface; resilience (fallback) добавляется позже тем же interface.

## Model benchmark / calibration (pre-implementation gate)

Дефолтная модель — **результат бенчмарка, не предположение**. Обязательный offline-шаг (скрипт, не
рантайм) ДО фиксации `WRITING_EVAL_MODEL`.

- **Проверяем первым: Gemini Flash** (единственный кандидат MVP). Точный id/версия резолвится здесь
  (вне cutoff — не фиксирую в спеке).
- **Reference = human-labeled ground truth.** Calibration set — N Task 2 эссе с известным band от
  ЛЮДЕЙ (Cambridge official / экспертная разметка), НЕ LLM-судья. (LLM-adjudicator для масштабной
  разметки — возможная будущая опция, вне MVP scope.)
- **Метрики:** (1) band-accuracy — отклонение range от ground-truth band; (2) cost/оценку;
  (3) latency; (4) schema-валидность (доля ответов, прошедших строгую JSON-схему без retry).
- **Acceptance gate ±0.5 — INTERNAL метрика выбора, НЕ user-facing обещание.** Gemini Flash идёт в
  MVP, только если band-accuracy в пределах ±0.5 band от ground-truth на наборе. В UX юзеру всё равно
  показываем **range + confidence**, без обещания точности ±0.5 (см. non-goals).
- **Провал планки:** Gemini Flash не проходит → ОТДЕЛЬНО пересматриваем модель/стоимость (другой
  кандидат/класс). НЕ тащим Claude заранее.

## Монетизация

- **Ultra-only по BRIEF §4.8** + **один полноценный бесплатный preview-разбор на аккаунт** (lifetime,
  не в день) как маркетинговый хук (ложится на frozen «AI = marketing hook»). Полный разбор, не
  урезанный — один настоящий wow-момент, дальше Ultra.
- Preview списывается при `completed` (failed не съедает).
- НЕ freemium-три-тира (это меняло бы §4.8). Если потом решим менять — обновляем §4.8 + tier-таблицу
  отдельным решением.

## Admin

Minimal форма (frozen-decision): создать `writing_task` (prompt + category + tier_required) → `draft`
→ publish-gate. Publish — осознанное подтверждение (не слепой flip), с показом темы перед публикацией
(урок P1 CLAUDE_AUDIT).

## UX `/app/writing`

- Каталог тем (published, по category) → выбор темы.
- Экран попытки: слева prompt + textarea + word-count + опц. таймер; submit → `pending/evaluating`
  состояние «анализирую…» (poll).
- Результат (по `completed`): `Estimated range 6.0–6.5` + confidence + main blocker + 4 rubric-карты
  + top-3 fixes + частичный rewrite + чек-лист.
- Снизу: история попыток (snapshot стабилен) + try again + progress-нота.
- `failed` → честное сообщение + retry (preview не списан).

## Безопасность / инварианты

- R/L grading/import/answer_key — ноль контакта. LLM только в `/api/writing/evaluate`.
- `writing_feedback_debug.raw_output` — server-only (grants revoked), не доходит до клиента.
- `evaluate` route internal (secret) + idempotent (status-claim). Защита от cost-abuse.
- Daily-cap на оценки (soft, для Ultra — frozen-decision) + free-preview lifetime-gate.
- Submission/feedback owner-scoped (RLS). Task published-gated.
- schema.ts ↔ migration up/down в lockstep; `npm run verify` при изменении схемы/RLS.

## Open questions (в план/реализацию, не блокеры дизайна)

- **Источник эталонного набора (ground truth)** — где взять N Task 2 эссе с human-band (для бенчмарка
  И few-shot калибровки): официальные образцы Cambridge / экспертная разметка. Блокер качества
  band-range и бенчмарка.
- **`WRITING_EVAL_MODEL`** — конкретный id Gemini Flash; заполняется после прохождения accuracy-планки
  на бенчмарке.
- **Vercel function timeout** для evaluate — фактический лимит на Hobby+Fluid; влияет на reaper-порог
  и нужен ли стриминг. Замерить.
- **Reaper-механизм** — ленивый (при чтении статуса) vs cron. Решить в плане.
- **Daily-cap число** — конкретное значение soft-cap для Ultra (placeholder, как `BASIC_DAILY_LIMIT`).

## Verification (как доказываем, не «должно работать»)

- `npm run verify` — новые таблицы/RLS (debug-таблица grants revoked; submission/feedback owner-scoped;
  task published-RLS) на local docker.
- `npx tsc --noEmit` + `npm run build`.
- `npm test` — чистая логика: word-count, JSON-schema валидатор feedback, idempotency-claim (pure),
  preview/cap-гейт, status-lifecycle переходы, reaper-предикат.
- Точечный fixture-тест evaluate с замоканным Gemini: pending→evaluating claim single-fire; повторный
  вызов no-op; provider fail/timeout → `failed` без списания preview; невалидная схема → in-call retry.
- Evaluator interface: нормализованный feedback-контракт на замоканном Gemini-ответе (форма выхода —
  строгая JSON-схема; interface не протекает provider-спецификой в Writing Lab).
```
