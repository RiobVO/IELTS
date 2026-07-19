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
инварианты; красное не уходит в прод сознательно (а ушедшее — детектится и откатывается);
система восстанавливается после сбоя.

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
  матчатся). CDP setEmulatedMedia = принудительный проход touch-ветки (regression-
  coverage браузера, не доказательство); доказательство реального touch — только
  устройство.
- **Supabase Free = 2 проекта**; второй проект = test-target. Free-проекты засыпают
  ~через 7 дней неактивности → ручной resume перед прогоном, БЕЗ фиктивного keep-alive.
- **Соло trunk-based**: локальный ОБЯЗАТЕЛЬНЫЙ pre-push контракт (= CLAUDE.md):
  `npx tsc --noEmit` всегда + `npm test` + `npm run build`; для payment/RLS/grading/
  миграций — ещё `npm run verify`. Затем push в main → Vercel деплоит, CI независимо
  перепроверяет. Честная формула: локальные проверки не дают сознательно пушить
  красное; CI обнаруживает расхождения ПОСЛЕ факта; post-deploy smoke — сигнал
  rollback-сценария. Роли CI: повтор в чистом окружении, детектор локальных отличий,
  журнал состояния коммитов.

## 4. Волна 0a — платёжные инварианты, provider-agnostic ⏱ СЕЙЧАС (2-3 дня)

**Почему первая:** единственный пункт с внешним дедлайном — окно «до merchant-ключей».
**Важно:** текущий вебхук — generic HMAC-заготовка, при онбординге мерчанта будет
переписан (зафиксировано прод-аудитом 2026-07-09; Payme = JSON-RPC + Authorization,
Click = form-encoded + md5-цепочка). Поэтому СЕЙЧАС тестируем только инварианты,
которые переживут любой протокол; provider-specific — в волне 0b.

Цели: `verifyWebhook()`/`applyCompletedPayment()` (`src/lib/payments/index.ts`),
route `app/api/webhooks/[provider]/route.ts`, `initiatePayment()`/`preorderPlan()`
(`app/app/upgrade/actions.ts`).

- [x] корректная / битая / отсутствующая подпись → reject
- [x] изменённое тело после подписи → reject
- [x] неизвестный provider, malformed JSON, неизвестный тип события (status ≠
      completed → `ignored`: принято без выдачи и без мутации)
- [x] duplicate webhook / replay старого / события не по порядку → идемпотентность
- [x] конкурентные webhook одного платежа → продление ровно один раз
- [x] атомарность «оплата → выдача доступа»; «деньги подтверждены, внутренняя
      операция упала» → восстановимое состояние, не потерянный платёж
- [x] tier/userId/period из webhook НЕ принимаются; подписанные amount/currency/status
      читаются и сверяются с pending-строкой (`reconcileClaims`, гейт по мерчант-ключу:
      real-режим fail-closed на отсутствии поля). orderId-сверка — провайдер-специфична
      (dual-id схема), поле зарезервировано в `WebhookClaims` → закрывается в 0b (§8)
- [x] недоплата / переплата / чужая валюта → доступ НЕ выдаётся
- [x] terminal-статус не регрессирует (completed не откатывается в failed/cancelled)
- [x] pending / not-found / expired / invalid статусы
- [x] продление того же тарифа; upgrade/downgrade Premium↔Ultra
- [x] rollback при падении profile update; retry после временного 500
- [x] failure injection: `UPDATE profile` вернул 0 строк — Drizzle НЕ бросает на нулевом
      апдейте, тест только на thrown error этот случай пропустит

**Итог волны (2026-07-19).** 0a-unit: +59 it (`plans.test` reconcileClaims,
`index.test` verifyWebhook/applyCompletedPayment, `route.test`, `actions.test`);
0a-db: `npm run test:db` (`vitest.config.db.ts`, `test/db/`, throwaway нативный PG,
env-перехват `test/db-setup.ts` ДО импорта `@/db` + БЕЗУСЛОВНЫЙ local-only guard,
remote-override у test:db нет) — 14 тестов, конкурентность/rollback-инъекции
триггерами, стабильно ×10. Codex-ревью диффа: blocker (remote-override guard'а)
и major (status-only событие → 500 вместо ignored) исправлены в этой же сессии;
reconcileClaims стал status-first — presence amount/currency обязателен только
на грант-пути (completed). Прод-фиксы волны:
(1) **stack-race** — решение stacking читало `profile.tier` без лока, два конкурентных
платежа одного юзера теряли оплаченный период → `SELECT ... FOR UPDATE` (порядок локов
profile→payment, тот же инвариант, что profile→content_item); тест был красным до фикса;
(2) `reconcileClaims`-seam (сверка подтверждённых провайдером amount/currency/status,
исход `ignored`); (3) guard нулевого `UPDATE profile` (`.returning()` + throw → rollback,
не молчаливый completed-без-доступа).

Acceptance — ДВЕ части, волна закрыта только когда обе зелёные:
- **0a-unit**: валидация, outcomes, route-mapping, fail-closed, server-trusted поля —
  мок-паттерн волны 2026-07-19, каждый инвариант отдельный it с негативом;
- **0a-db**: конкурентные webhook, single-claim, rollback, идемпотентность — на
  throwaway нативном PG (моки доказывают ветвление, транзакционность — нет).

Инфра-шаг в этой же волне (вечер): завести ВТОРОЙ Supabase Free проект (test-target
для 0b/волны 2) — создать СЕЙЧАС, ключи могут прийти раньше волны 2.
**Owner-действие (Dashboard), на 2026-07-19 ещё не сделано** — единственный
открытый пункт волны, код-часть закрыта.

**Правило прерывания:** получение merchant-ключей немедленно прерывает любую текущую
волну и запускает 0b; 0b блокирует production-активацию независимо от прочих чекбоксов.

## 5. Волна 1 — CI-фундамент ⏱ день

Сейчас в `.github/workflows/ci.yml`: `npm ci` + `tsc --noEmit` + `npm test`. Добавить:

- [x] `npm run build` (production build graph)
- [x] verify-job: PG service-контейнер → bootstrap → `npm run verify`
      (миграции/RLS/health/auth-trigger в чистом окружении) + `test:db` ×3
      (0a-db; полный ×10 остаётся локальным контрактом)
- [x] post-deploy read-only smoke против прода (после Vercel-деплоя; красный = сигнал
      отката). `post-deploy-smoke.yml` на `deployment_status` (environment=Production):
      health/лендинг/pricing/auth на bando.study. Preview-smoke — НЕ на каждый push:
      при обычном push в main предварительного preview не существует; временная ветка
      с preview — только для рискованных релизов (платежи, iframe, mobile)
- [x] поправить комментарий `.github/workflows/ci.yml` (называет CI «гейтом между push
      и Vercel» — фактически CI = детектор после факта)
- [x] floor на количество тестов (`scripts/check-test-floor.mjs`: passed ≥ 1500,
      skipped ≤ 10; пороги поднимать вручную при росте сьюта)
- [x] отчёт coverage БЕЗ гейта (`coverage.include` на все prod-файлы — видимость,
      не культ; baseline 2026-07-19 ≈ 60% statements)

Дешёвые тумблеры — сделаны 2026-07-19: Dependabot alerts включены (API, без
workflow-файла), `npm audit --audit-level=high` в CI (moderate видны в логе, не
красят журнал), freshness-чек бэкапа = CI-джоб `backup-freshness` (красный, если
последний успешный дамп старше 48ч — рецидив «бэкапы пусты 5 дней» теперь виден
на каждом push) + restore-smoke в `db-backup.yml` (дамп рестворится в scratch-PG,
≥37 app-таблиц, `profile` непустой — прошёл на реальном прод-дампе), gitleaks по
всей истории в CI (чисто). GitHub secret scanning и CodeQL на ПРИВАТНОМ Free
НЕдоступны (платные Secret Protection / Code Security) — триггер в §12.

Acceptance: красный любой ступени = красный коммит в журнале CI; время прогона ≤15 мин.
**Факт 2026-07-19: все 6 джобов зелёные с первого прогона, wall-clock ~2 мин;
smoke прошёл на живом Production-деплое.** Codex-ревью волны: 2 high исправлены
тут же — smoke стал двухслойным (слой 1: /api/health несёт `commit` =
VERCEL_GIT_COMMIT_SHA, канон обязан отдать sha ИМЕННО этого деплоя — убивает
гонку «зелёный по старому релизу до переключения alias»; environment_url не
годится — уникальные URL закрыты Vercel Authentication, 302, проверено живым
прогоном; слой 2: контент-маркеры на каждой HTML-пробе), restore-smoke без
`||true` (pipefail)
с ассертами по именам критических таблиц + post-data представителю
(unique-constraint payment, структурно по contype — автоимя PG в миграции 0006
≠ имени в Drizzle-схеме, первый живой прогон поймал ровно это); попутно
gitleaks запинен на commit SHA, db-backup
получил минимальный permissions-блок, floor требует численные skipped-счётчики
(дрейф схемы отчёта = красный). Отклонено осознанно: недетерминизм npm audit —
это роль детектора (upstream high-advisory обязана красить журнал).

## 6. Волна 1.5 — native-PG: данные и гонки ⏱ ~неделя

То, что мок-тесты честно пометили как «предикат запинен, атомарность не доказана».
Площадка: throwaway нативный PG (локально) + PG service-контейнер (CI).
Актуально УЖЕ (600 юзеров жмут submit), независимо от платежей.

Конкурентность (2 клиента, реальные транзакции):
- [x] два одновременных старта при лимите 2 → проходят ровно 2, третий — отказ
- [x] два конкурентных старта ОДНОГО item → одна попытка, второй получает resume
      (+ вариант на границе капа limit−1: проигравший обязан получить resume, не
      ложный cap-отказ — ловит recheck-под-локом)
- [x] два одновременных submit одной попытки → ровно один рейтинг/XP/badge/notification
      (через экстракцию `finalize-submit.ts` — см. итог)
- [x] конкурентный referral reward → начисляется один раз
- [x] падение внутри транзакции → откат всех связанных записей (инъекции триггерами:
      applyPostSubmit, startAttempt-trial, finalizeSubmit-после-claim)
- [x] порядок локов profile→content_item под нагрузкой → без deadlock
- [x] повторное применение webhook/event — уже закрыт 0a-db (replay/out-of-order/
      конкурентные webhook на реальном PG), не дублирован; дыр не найдено

RLS / cross-user матрица (расширение verify.ts; прецедент — живая проверка notification):
- [x] параметризованная матрица ПО ОПЕРАЦИЯМ (SELECT/INSERT/UPDATE/DELETE), не общим
      «да/нет»: anon — всё нет; user A — своё по контракту / чужое нет; user B —
      симметрично; owner-path по контракту
- [x] таблицы: profile, attempt, annotation, notification, writing_*/speaking_*
      (submissions+feedback+debug), vocab_progress, saved_word, mistake_resolution,
      mistake_review, payment, preorder + answer_key/attempt_review_snapshot (hard-lock)
- [x] прод-постура поверх: `scripts/check-rls-posture.ts` (read-only, контракт
      `test/db/rls-contract.ts` общий с матрицей) — relrowsecurity + pg_policies +
      role_table_grants + column_privileges (колоночные-only права вычитанием
      табличных, PUBLIC-гранты, обязательный SELECT у selectOnly, OR-guard
      предикатов); живые anon/A/B-запросы — в локальной матрице

Схема:
- [x] миграции с нуля + последовательное применение (globalSetup: полный migrateUp
      каждый прогон + сверка `_migrations` с `listMigrations()`); constraints
      (FK/unique/check), функции и триггеры — `schema.db.test.ts`

Acceptance: сьют на throwaway-БД, детерминированный, в CI и локально; 5-10 прогонов
без флака (конкурентные тесты — по гоче).

**Итог волны (2026-07-19, `3487a13..0b96658`).** Сьют test:db 14→102 тестов
(+attempts 14, +rls 56, +schema 18), стабильно ×8 до ревью и ×5 после фиксов; CI
подхватил автоматически (verify-job гоняет test:db ×3). Экстракция
`src/lib/exam/finalize-submit.ts`: single-fire claim сабмита + applyPostSubmit
вынесены из `submitAttempt` (за Supabase-auth db-тесту недоступны) поведением
байт-в-байт — инвариант «ровно один рейтинг/XP/бейдж» тестируется на реальном коде.
`after()` из next/server в db-тестах мокается очередью + `flushAfter()` (отложенные
эффекты наблюдаемы), телеметрия — мок-fn с ассертом payload. **Прод-фиксы волны:
миграции 0056/0057** — read-only постура-скрипт поймал Supabase default-priv дрейф
на `profile`/`attempt` (anon держал ВСЕ привилегии, authenticated — DELETE+служебные;
0010 ревокал только INSERT/UPDATE), затем Codex-ревью добило «drift-когорту»
annotation/payment (RLS не покрывает TRUNCATE/REFERENCES/TRIGGER — дрейф не был
инертен). Обе применены на прод, постура 19/19 чистая по строгому контракту без
исключений. Codex-ревью диффа: 0 blocker, 5 major (все закрыты: deadlock-тест
разворачивает cause-цепочку Drizzle и падает на любой неожиданной ошибке; контракт
требует НАЛИЧИЯ SELECT и видит колоночные/PUBLIC-гранты; 0057; OR-guard предикатов;
best-effort-семантика claim→progression зафиксирована инъекционным тестом как
осознанный контракт — сбой прогрессии не теряет сабмит и виден в error_log,
прод-семантика не менялась) + 7 minor (5 закрыто, 2 отклонено осознанно:
owner-матрица UPDATE/DELETE — тавтология суперюзера; rendezvous-барьер — машинерия
с собственным флак-риском, ограничение задокументировано в тесте).

## 7. Волна 2 — hosted Supabase контракты ⏱ вечер (завести) + по готовности

Нативный PG НЕ доказывает: PostgREST-семантику, Supabase Auth/JWT, Storage policies,
signed URLs, uploads, поведение реального supabase-js. Для этого:

- [ ] второй Supabase Free проект (test-target, НЕ прод) — **OWNER-ГЕЙТ волны:
      действие в Dashboard за владельцем (не сделано с 0a); все пункты ниже, кроме
      hard guard, без него не стартуют**
- [ ] прогон миграций в Supabase-окружении
- [ ] PostgREST/Auth: RLS через реальные API двумя юзерами (IDOR-матрица §6 — через
      HTTP-слой; контракт переиспользовать из `test/db/rls-contract.ts`, не дублировать)
- [ ] Storage: policies бакетов speaking/source-html, upload/download, signed URLs,
      service-role границы
- [ ] hard guard E2E-окружения — **код-only, можно ДО test-target (точка входа
      волны)**: `SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_URL` + `DATABASE_URL` +
      `DIRECT_URL` обязаны указывать на ОДИН test-ref; известный прод-ref запрещён
      во ВСЕХ переменных. Сейчас дыра: `stateful-gate.ts:39` смотрит только
      DATABASE_URL/DIRECT_URL, а `e2e/admin.ts:32` создаёт юзеров через
      SUPABASE_URL — смешанное окружение пройдёт гейт и создаст юзера в проде.
      Юнит-тесты на mismatch и prod-rejection
- [ ] payment webhook integration — НЕ здесь: hosted Supabase не даёт публичный
      HTTPS-эндпойнт Next.js; реальный webhook-колбэк живёт в топологии 0b (Preview)
- [ ] процедура прогона: health-check → resume если paused (вручную из Dashboard) →
      миграции → сид тестовых данных → контракты

## 8. Волна 0b — sandbox-окно провайдера ⏱ ДЕДЛАЙН: между ключами и включением платежей

Обязательное окно, платежи НЕ включаются до прохождения.

**Топология:** временный Vercel Preview (ветка ТОЛЬКО для merchant-онбординга — это не
переход на PR-flow) + Preview env → Supabase test-target + sandbox-ключи + публично
достижимый webhook-колбэк (Protection Bypass / доступ провайдера).

**Модель активации.** Код сейчас: `paymentsLive()` в проде = «prod-ключ задан»
(`payments/index.ts:56-59`), т.е. ДОБАВИТЬ ключ в Production env — уже ВКЛЮЧИТЬ платежи.
Поэтому:
- [ ] sandbox-ключи ТОЛЬКО в Preview env; production-ключи НЕ добавлять до acceptance 0b
- [ ] отдельный activation-флаг — разделить «ключ настроен» и «платежи включены»
      (прод-изменение, реализуется при онбординге)
- [ ] тест-матрица: нет ключа / ключ есть + flag off / ключ есть + flag on
- [ ] процедура аварийного выключения платежей БЕЗ удаления/ротации ключей
- [ ] владелец утверждает реальные цены (plans.ts — placeholders, тест сумм намеренно
      их не пинит)

Sandbox-прогон:
- [ ] подключить sandbox/test merchant
- [ ] получить реальные подписанные payload; сверить документацию с фактом
- [ ] provider-specific контракт-фикстуры (Payme/Click/Uzum — какой(ие) выбран(ы));
      точные HTTP/JSON-RPC ответы соответствуют контракту провайдера
- [ ] provider status/amount/currency/merchant ID/orderId сверяются с нашей
      pending-строкой; orderId принадлежит именно этому заказу
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

Golden paths — три подволны, ядро НЕ ждёт мерчанта:
- **3a (можно сейчас):** login/session, reading autosave/reload/submit, full mock iframe;
- **3b (по фичам):** writing, speaking, admin import, vocabulary;
- **3c (после 0b):** payment sandbox E2E.

Полный целевой список из аудита:
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

Нюанс email-флоу: `e2e/admin.ts` создаёт сразу confirmed-юзера через Admin API, обходя
почту — реальные confirmation/password-reset письма автоматикой НЕ проверяются;
это отдельный ручной/интеграционный сценарий.

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
| Mutation testing, ZAP | зрелость/команда/выручка |
| GitHub secret scanning / CodeQL (платные для приватного Free) | платный GitHub-тариф или публичный репо |
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
| 0a платёжные инварианты (0a-unit + 0a-db) + 3 прод-фикса (stack-race FOR UPDATE, reconcileClaims, grant-guard) | ✅ код закрыт; test-target Supabase — за владельцем | 2026-07-19 |
| 1 CI-фундамент | ✅ закрыта | 2026-07-19 (`81acc4d..cdb8ca6`) |
| 1.5 native-PG данные/гонки + прод-фиксы 0056/0057 (grant-lockdown) | ✅ закрыта | 2026-07-19 (`3487a13..0b96658`) |
| 2 hosted Supabase контракты | ⬜ следующая (ждёт test-target Supabase — за владельцем) | — |
| 0b sandbox-окно | ⬜ ждёт ключей | — |
| 3 браузер + устройства | ⬜ по триггерам | — |
| 4 эксплуатация | ⬜ по триггерам | — |
