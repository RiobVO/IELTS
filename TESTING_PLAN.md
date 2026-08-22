# TESTING_PLAN.md — трек зрелости тестирования

> Трек-документ (прецедент — PRACTICE_PLAN.md). Источник: внешний аудит зрелости
> тестирования (Codex, 3 итерации adversarial-ревью, 2026-07-19) + внутренние поправки.
> Исполняется по волнам через несколько сессий; сессия отмечает чекбоксы и статус внизу.
> BRIEF.md остаётся единственной истиной по продукту; здесь — только тестовый контур.

---

## 1. Контекст и цель

Стадия проекта: стелс-запуск ~600 юзеров из 2 ТГ-каналов, платежи НЕ включены
(merchant-ключи ожидаются), контент заливается клиентом, соло-разработка,
Vercel Hobby + Supabase Free.

Оценка зрелости (внешний аудит 2026-07-19), **≈6/10 итого**:

| Область | Оценка |
|---|---:|
| Unit-тесты чистой логики | 9/10 |
| Импорт, парсинг, грейдинг | 8/10 |
| Миграции и базовая RLS-постура | 7/10 |
| Реальные транзакции и гонки PostgreSQL | 4/10 |
| API и Server Actions | 5/10 |
| Браузерные пользовательские пути | 3/10 |
| Компоненты и UI-состояния | 2/10 |
| CI/CD как release-gate | 4/10 |
| Performance, accessibility, resilience | 2/10 |

Сильные стороны (не трогать, не дублировать): грейдинг/band/SRS/тарифы/прогресс/
геометрия графика; парсеры и санитайзеры; adversarial-тесты импортёра; серверные
ветвления W/S; защита `answer_key`/debug-таблиц; verify.ts (миграции up→down→up,
auth-trigger); запрет stateful E2E против прод-БД; бэкапы + restore-runbook.

**Цель — не покрытие, а пять доказательств** (формула аудита):
юзер проходит ключевой путь; чужие данные недоступны; конкурентные запросы не ломают
инварианты; деплой не проходит с красными проверками; система восстанавливается после сбоя.

## 2. Три класса гарантий

1. **Автоматизировано** — CI/локальные прогоны.
2. **Ручной release-гейт** — короткий обязательный чек-лист с фиксацией прохождения
   (реальные устройства, sandbox-платежи).
3. **Отложено по инфре/триггеру** — честно помечено, с условием включения (§12).

## 3. Инфра-ограничения и процессные решения (проверено, не предлагать заново)

- **Docker мёртв** на дев-машине (2026-07-07, не чиним) → Supabase Local невозможен;
  локальная БД-инфра = нативный PostgreSQL (throwaway `ielts_verify`). В CI —
  PG service-контейнер GitHub Actions.
- **GitHub Free (приватный репо)** → required checks / protected branches недоступны.
  PR-flow сейчас НЕ вводим (см. анти-цели §13); CI = детектор после факта, не гейт.
- **Vercel Hobby** → полноценного deployment-gate нет; preview-деплои и
  Protection Bypass для автоматизации доступны.
- **Playwright/эмуляция НЕ доказывает touch** (`pointer:coarse`/`hover:none` не
  матчатся) — touch-ветки только реальное устройство или CDP setEmulatedMedia.
- **Supabase Free = 2 проекта**; второй проект = test-target. Free-проекты засыпают
  ~через 7 дней неактивности → ручной resume перед прогоном, БЕЗ фиктивного keep-alive.
- **Соло trunk-based**: локально `build+test` перед пушем → push в main → Vercel деплоит,
  CI независимо перепроверяет. Роли CI: повтор в чистом окружении, детектор
  локальных отличий, журнал состояния коммитов, сигнал отката.

## 4. Волна 0a — платёжные инварианты, provider-agnostic ⏱ СЕЙЧАС (1-2 дня)

**Почему первая:** единственный пункт с внешним дедлайном — окно «до merchant-ключей».
**Важно:** текущий вебхук — generic HMAC-заготовка, при онбординге мерчанта будет
переписан (зафиксировано прод-аудитом 2026-07-09; Payme = JSON-RPC + Authorization,
Click = form-encoded + md5-цепочка). Поэтому СЕЙЧАС тестируем только инварианты,
которые переживут любой протокол; provider-specific — в волне 0b.

Цели: `verifyWebhook()`/`applyCompletedPayment()` (`src/lib/payments/index.ts`),
route `app/api/webhooks/[provider]/route.ts`, `initiatePayment()`/`preorderPlan()`
(`app/app/upgrade/actions.ts`).

- [ ] корректная / битая / отсутствующая подпись → reject
- [ ] изменённое тело после подписи → reject
- [ ] неизвестный provider, malformed JSON, неизвестный тип события
- [ ] duplicate webhook / replay старого / события не по порядку → идемпотентность
- [ ] конкурентные webhook одного платежа → продление ровно один раз
- [ ] атомарность «оплата → выдача доступа»; «деньги подтверждены, внутренняя
      операция упала» → восстановимое состояние, не потерянный платёж
- [ ] сумма/tier/user ID из webhook-тела НЕ доверяются (маппинг только по нашим записям)
- [ ] pending / not-found / expired / invalid статусы
- [ ] продление того же тарифа; upgrade/downgrade Premium↔Ultra
- [ ] rollback при падении profile update; retry после временного 500

Acceptance: юнит-сьют по мок-паттерну волны 2026-07-19, `npm test` зелёный,
каждый инвариант — отдельный it с негативом.

## 5. Волна 1 — CI-фундамент ⏱ день

Сейчас в `.github/workflows/ci.yml`: `npm ci` + `tsc --noEmit` + `npm test`. Добавить:

- [ ] `npm run build` (production build graph)
- [ ] verify-job: PG service-контейнер → bootstrap → `npm run verify`
      (миграции/RLS/health/auth-trigger в чистом окружении)
- [ ] Playwright smoke против Vercel preview (Protection Bypass токен)
- [ ] floor на количество тестов (детект «прошло, потому что massово skipped»)
- [ ] отчёт coverage БЕЗ гейта (`coverage.include` на все prod-файлы — видимость,
      не культ; vitest предупреждает: без include видны только импортированные файлы)

Дешёвые тумблеры туда же (минуты): Dependabot, secret scanning, `npm audit` в CI,
freshness-чек бэкапа в существующий backup-workflow.

Acceptance: красный любой ступени = красный коммит в журнале CI; время прогона ≤15 мин.

## 6. Волна 1.5 — native-PG: данные и гонки ⏱ ~неделя

То, что мок-тесты честно пометили как «предикат запинен, атомарность не доказана».
Площадка: throwaway нативный PG (локально) + PG service-контейнер (CI).
Актуально УЖЕ (600 юзеров жмут submit), независимо от платежей.

Конкурентность (2 клиента, реальные транзакции):
- [ ] два одновременных старта при лимите 2 → проходят ровно 2, третий — отказ
- [ ] два конкурентных старта ОДНОГО item → одна попытка, второй получает resume
- [ ] два одновременных submit одной попытки → ровно один рейтинг/XP/badge/notification
- [ ] конкурентный referral reward → начисляется один раз
- [ ] падение внутри транзакции → откат всех связанных записей
- [ ] порядок локов profile→content_item под нагрузкой → без deadlock
- [ ] повторное применение webhook/event (пересечение с 0a — здесь на реальной БД)

RLS / cross-user матрица (расширение verify.ts; прецедент — живая проверка notification):
- [ ] параметризованная матрица: anon (нет/нет/нет), user A (своё да / чужое нет /
      запись только разрешённое), user B (симметрично), owner-path по контракту
- [ ] таблицы: profile, attempt, annotation, notification, writing_*/speaking_*
      (submissions+feedback), vocab_progress, saved_word, mistake_resolution,
      mistake_review, payment, preorder
- [ ] прод-проверка `pg_policies` остаётся обязательной поверх (default-priv grants
      Supabase локально не воспроизводятся — известная гоча)

Схема:
- [ ] миграции с нуля + последовательное применение; constraints (FK/unique/check),
      функции и триггеры

Acceptance: сьют на throwaway-БД, детерминированный, в CI и локально; 5-10 прогонов
без флака (конкурентные тесты — по гоче).

## 7. Волна 2 — hosted Supabase контракты ⏱ вечер (завести) + по готовности

Нативный PG НЕ доказывает: PostgREST-семантику, Supabase Auth/JWT, Storage policies,
signed URLs, uploads, поведение реального supabase-js. Для этого:

- [ ] второй Supabase Free проект (test-target, НЕ прод)
- [ ] прогон миграций в Supabase-окружении
- [ ] PostgREST/Auth: RLS через реальные API двумя юзерами (IDOR-матрица §6 — через HTTP-слой)
- [ ] Storage: policies бакетов speaking/source-html, upload/download, signed URLs,
      service-role границы
- [ ] payment webhook integration (эндпойнт на реальном стеке)
- [ ] процедура прогона: health-check → resume если paused (вручную из Dashboard) →
      миграции → сид тестовых данных → контракты

## 8. Волна 0b — sandbox-окно провайдера ⏱ ДЕДЛАЙН: между ключами и включением платежей

Обязательное окно, платежи НЕ включаются до прохождения:

- [ ] подключить sandbox/test merchant
- [ ] получить реальные подписанные payload; сверить документацию с фактом
- [ ] provider-specific контракт-фикстуры (Payme/Click/Uzum — какой(ие) выбран(ы))
- [ ] прогнать success / failed / cancelled / expired / duplicate / retry
- [ ] один платёж = ровно одна выдача доступа
- [ ] восстановление после искусственной внутренней ошибки
- [ ] redirect-back и состояние checkout после обновления страницы
- [ ] зафиксировать результаты прогона в этом файле
- [ ] только после этого — production merchant

## 9. Волна 3 — настоящий браузер + устройства

Распределение для ExamRunner (НЕ jsdom-болото — см. анти-цели):

| Что | Чем |
|---|---|
| Чистые расчёты, переходы состояния | Vitest без DOM (уже) |
| Маленькие стабильные UI-компоненты | Component tests (точечно) |
| Autosave, submit, восстановление сессии | Playwright, настоящий браузер |
| Iframe bridge / postMessage | Playwright integration |
| Sandbox, allowed origins, CSP | Route + browser security tests |
| Навигация, таймер, завершение экзамена | Playwright E2E |
| Touch-ветки, мобильная клавиатура | Реальный телефон (ручной гейт) |

Golden paths (наращивать постепенно, полный целевой список из аудита):
- [ ] signup → подтверждение email → onboarding → dashboard
- [ ] login → logout → session protection
- [ ] password reset → callback → новый пароль
- [ ] reading practice: ответы → autosave → reload → resume → submit → разбор
- [ ] full mock через iframe: bridge/postMessage → таймер → submit → result
- [ ] listening: старт аудио, пауза, resume, переходы частей
- [ ] Basic cap на границе лимита
- [ ] vocabulary review + saved words
- [ ] writing: store → evaluation → polling → result
- [ ] speaking: permission → upload → evaluation → delete
- [ ] admin import → review → publish → каталог
- [ ] payment sandbox (после 0b)

Устройства — ручной release-гейт (короткий чек-лист + фиксация прохождения):
- [ ] реальный iPhone Safari; реальный Android Chrome
- [ ] аудио, touch, клавиатура, scroll, orientation

Существующее: `e2e/smoke.spec.ts` (4 сценария, Desktop Chrome only),
`_mobile_gate.ts` gitignored (одноразовый) — формализовать в версионируемый чек-лист.

## 10. Волна 4 — эксплуатационная зрелость

- [ ] restore-drill автоматизировать: freshness бэкапа, регулярное восстановление в
      disposable DB, контрольные counts + критические связи, RPO/RTO, отчёт,
      репетиция rollback миграции
- [ ] performance: Lighthouse CI (landing/auth/dashboard/practice), Web Vitals budget,
      bundle-size budget
- [ ] load (k6, исполняемые пороги latency/error rate — не графики): login throttle,
      start/submit, catalog, result, cron; burst на PgBouncer pool; большие каталоги /
      тысячи attempts
- [ ] resilience: деградация при недоступности PostHog / Gemini / Telegram / Brevo / Sentry
- [ ] accessibility: axe-скан WCAG A/AA ключевых экранов, клавиатурный проход,
      focus order, accessible names / aria-current, contrast (+ ручная оценка — автоматика
      ловит только часть)
- [ ] visual regression: toHaveScreenshot baselines desktop/mobile, маскирование
      динамики (даты/рейтинги/таймеры)
- [ ] security-автоматика: dependency review, CodeQL/SAST, OWASP ASVS чек-лист,
      периодический ZAP baseline против test-стенда, тест CSP/security headers,
      тест отсутствия answer_key/debug/секретов в RSC/HTML/bundle
- [ ] synthetic smoke после production-деплоя + runbook отката
- [ ] mutation testing (точечно: grading, тарифные капы, signature validation,
      RLS helpers, idempotency-предикаты) — после появления coverage-baseline
- [ ] coverage: baseline + запрет ухудшения; повышенные branch-thresholds для
      grading/exam/payments/auth/import/tiers; без 100%-культа для страниц/UI

## 11. P1-реестр: неравномерное покрытие API/actions (из аудита, закрывать по мере касания)

Правило: тронул модуль — закрой его строку. Route handlers с тестом: 7/18;
actions: 3/16. Непокрыто (полный список аудита):

- [ ] auth actions + OAuth callback
- [ ] exam runner route + его security headers
- [ ] payment webhook route (→ волны 0a/0b)
- [ ] speaking evaluate route
- [ ] onboarding actions
- [ ] notifications actions
- [ ] practice/mistakes actions
- [ ] sprint actions
- [ ] vocabulary / saved words actions
- [ ] admin actions
- [ ] 5 из 8 cron jobs
- [ ] real import fixtures: 4 skipped-теста реальных образцов (parse-test:216,
      parse-reading-full:328, parse-listening:282) → обезличенные minimized
      golden-фикстуры в репо; триггер — ритмичный контент-поток от клиента
- [ ] компонентный слой: 152 TSX / 0 `.test.tsx`; точечно и только стабильные мелкие
      компоненты (крупные: ExamRunner ~2449 строк, _PracticeCatalog ~1189,
      ReviewSession ~860, ResultCoach ~881 — покрываются через §9, НЕ jsdom);
      кандидаты сценариев: keyboard nav, disabled/loading/error/empty, autosave
      debounce, таймер, фильтры, focus trap, audio controls, optimistic rollback,
      stale router cache после мутации

## 12. Триггеры включения отложенного

| Что | Триггер |
|---|---|
| Волна 0b (sandbox, provider-specific) | получены merchant-ключи |
| Golden import fixtures | ритмичный контент-поток клиента |
| PR-flow + required checks (GitHub Pro / публичный репо) | второй человек в репо / внешние контрибьюторы / compliance |
| Полный E2E-набор §9 + payment sandbox E2E | мерчант подключён |
| Component tests / visual regression | редизайн, дизайн-система или частые UI-регрессы |
| Load/k6, Lighthouse CI гейты | платящие юзеры / >1-2k MAU |
| A11y-автоматика | партнёрства (школы) или жалобы |
| Mutation testing, ZAP, CodeQL | зрелость/команда/выручка |
| Nightly-контур (полный E2E, 3 браузера, контракты, fuzz) | когда есть что гонять ночью (после волн 2-3) |
| Мобильная browser-matrix (WebKit/Firefox) | только width-зависимое; touch остаётся за реальным устройством |

## 13. Анти-цели (сознательно НЕ делаем)

- НЕ вводим PR-flow/церемонию для соло — сам себе разрешать merge бессмысленно.
- НЕ строим jsdom-тесты на ExamRunner/iframe — тестирование моков браузера, не продукта.
- НЕ считаем Playwright-эмуляцию доказательством touch-поведения.
- НЕ фальсифицируем Supabase тестами, которые проверяют только PostgreSQL (границы
  честно помечены: PostgREST/Auth/Storage → волна 2).
- НЕ гонимся за 90-100% coverage и «3000 тестов» — только риск-взвешенные проверки.
- НЕ держим test-проект Supabase искусственно бодрым (keep-alive) — ручной resume.

## 14. Статус

| Волна | Статус | Сессия |
|---|---|---|
| Тестовая волна юнит-покрытия + 4 прод-фикса | ✅ закрыта | 2026-07-19 (`6a85762..72a2365`) |
| 0a платёжные инварианты | ⬜ следующая | — |
| 1 CI-фундамент | ⬜ | — |
| 1.5 native-PG данные/гонки | ⬜ | — |
| 2 hosted Supabase контракты | ⬜ | — |
| 0b sandbox-окно | ⬜ ждёт ключей | — |
| 3 браузер + устройства | ⬜ по триггерам | — |
| 4 эксплуатация | ⬜ по триггерам | — |
