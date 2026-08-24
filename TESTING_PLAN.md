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
- **GitHub Free, репо ПУБЛИЧНЫЙ** → protected branches, CodeQL и secret scanning
  доступны бесплатно. На `main` включена мягкая защита (запрет force-push/удаления,
  БЕЗ required-PR — соло trunk-based сохранён, §13). PR-flow/required-checks НЕ вводим
  (анти-цели §13); CI = детектор после факта, не гейт.
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
всей истории в CI (чисто). GitHub secret scanning + push protection, Dependabot
alerts/security-updates и CodeQL default setup (js-ts + actions) ВКЛЮЧЕНЫ 2026-07-20
(бесплатны для публичного репо) — дополняют gitleaks (push protection не даёт
запушить новый секрет, CodeQL — статический security-скан).

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

- [x] второй Supabase Free проект (test-target, НЕ прод) — **заведён 2026-07-20**:
      `ielts-test`, ref `ajmeboekpxyjqtcowerj`, eu-central-1, Free. Креды в
      `.env.test.local` (gitignored): legacy JWT anon/service_role + pooler-строки.
      Free засыпает ~7 дней простоя → ручной resume перед прогоном
- [x] прогон миграций в Supabase-окружении — **закрыт 2026-07-20**: обёртка
      `scripts/lib/test-target-env.ts` (`loadTestTargetEnv`, fail-fast на прод-ref,
      зеркалит контракт stateful-gate) + `scripts/migrate-test.ts` (только up/status,
      деструктив недоступен) + npm `db:migrate:test`/`db:status:test`. Все 58 миграций
      applied на hosted; `db:status:test` — pending (none)
- [x] PostgREST/Auth: RLS через реальные API двумя юзерами — **закрыт 2026-07-20**:
      `test/hosted/rls-http.ts` (`runIdorMatrix`) + `scripts/rls-http-test.ts` + npm
      `test:hosted:rls`. Два юзера через service-role admin API, РЕАЛЬНЫЙ логин
      (signInWithPassword → JWT), пробы через supabase-js/PostgREST. Ожидания из
      общего `RLS_CONTRACT` (не дублируются). 19 таблиц PASS / 0 FAIL / 0 SKIP: 15
      owner-scoped (positive control A/B + cross-user deny + anon deny + write-deny) +
      4 hard-lock (owner-путь читает засев, anon+authenticated grant-deny). Инвариант:
      positive control в каждой пробе → провал позитива = FAIL, не skip (0 строк
      «из-за RLS» ≠ 0 «не засеяли»); SKIP тоже краснит exit (пропущенная таблица =
      непроверенная изоляция, не «чисто»). Cleanup: deleteUser-каскад + явное
      удаление `speaking_audio_event` (его FK `ON DELETE SET NULL`, не CASCADE) +
      fixture-корни из аккумулятора (чистятся и при частичном падении посева);
      прогон ×2 идентичен
- [x] Storage: policies бакетов speaking/source-html — **закрыт 2026-07-20**:
      **Канон** `scripts/lib/storage-provisioning.ts` — единственный источник истины
      (speaking-audio private/10MB/owner-policy; source-html private/без policy):
      `applyStorageProvisioning` (SETUP) + `verifyStorageProvisioning` (READ-ONLY
      сверка через `storage.buckets`+`pg_policies`). Прод-скрипт `setup-speaking-storage.ts`
      и тест-setup `setup-test-storage.ts` (npm `test:hosted:storage:setup`) идут из
      канона — дубль SQL убран. **Контракт `test:hosted:storage` больше НЕ self-heal'ит**
      (Codex P1): verify-гейт первым — при дрейфе (нет policy / ослаблены roles /
      public=true / лишняя permissive policy на source-html) FAIL + подсказка setup,
      exit 1 БЕЗ поведенческих проб. Доказано вживую: `drop policy` → контракт КРАСНЕЕТ
      (не чинит), setup → снова зелёный. verify строгий (2-й раунд Codex): точная сверка
      qual/with_check с каноном (ослабление `+OR true` краснеет), roles ровно
      `[authenticated]` (лишняя роль краснеет), нет лишних АДРЕСНЫХ policy на speaking-audio
      помимо канонической, source-html дрейф по ТОЧНОМУ литералу `'source-html'`
      (не задевает `source-html-archive`); setup лечит лишнюю source-html policy (дропает).
      Поведенческие пробы (service-role upload, signed URL 200, anon-deny, authenticated
      owner-positive/cross-user download+upload deny/source-html default-deny, service-role
      границы) — ловят bucket-agnostic `insert with check(true)`, который каталог не адресует.
      Остаточный edge (документирован): path-scoped agnostic-policy и anon-insert по расширению —
      узкий класс, не полируется. Cleanup best-effort (уникальные имена per-прогон)
- [x] hard guard E2E-окружения — **закрыт 2026-07-19 (точка входа волны)**:
      `statefulE2eBlockReason` (`e2e/stateful-gate.ts`) — строгий контракт:
      флаг + все четыре переменные (`SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`/
      `DATABASE_URL`/`DIRECT_URL`) обязаны резолвиться в ОДИН не-прод ref через
      `new URL()`-парсинг (анкерованные hostname/username-форматы, ref ровно 20
      символов), прод-ref запрещён substring'ом case-insensitive в каждой.
      Codex-ревью (2 раунда): Critical (обход неанкерованного regex приманкой в
      query + trailing-dot/UPPERCASE прод-хост) и High (гейт не привязан к
      app-серверу) закрыты — `SMOKE_BASE_URL` обязан быть НЕ задан для stateful,
      `playwright.config.ts` не переиспользует чужой сервер при включённом гейте
      (`reuseExistingServer: !isStatefulE2eAllowed`). 41 юнит-тест, включая
      полный decoy-bypass по всем четырём переменным
- [ ] payment webhook integration — НЕ здесь: hosted Supabase не даёт публичный
      HTTPS-эндпойнт Next.js; реальный webhook-колбэк живёт в топологии 0b (Preview)
- [x] процедура прогона (runbook, ручной — НЕ в CI, тест-проект засыпает):
      1. **health/resume**: открыть Dashboard `ielts-test`; если paused (>7 дней) —
         Restore, дождаться healthy;
      2. **env**: `.env.test.local` заполнен (все 4 URL на тест-ref, gitignored);
      3. **миграции**: `npm run db:migrate:test` → `npm run db:status:test` (pending none);
      4. **постура**: `npm run test:hosted:posture` (19/19 чисто);
      5. **IDOR**: `npm run test:hosted:rls` (19 PASS, 0 FAIL); сид + cleanup внутри;
      6. **storage**: `npm run test:hosted:storage` (2 бакета + границы).
      Все раннеры fail-fast'ят на прод-ref через `loadTestTargetEnv` — прод недостижим
      (плюс требуют все 6 переменных ИМЕННО в `.env.test.local`, не унаследованными
      из shell).

**Codex-ревью волны (2026-07-20).** 0 blocker/Critical (обход guard на прод не
найден). Закрыты: 2 High (SKIP давал зелёный exit → теперь краснит; Storage не
проверял authenticated-доступ → добавлен реальный JWT-юзер owner/cross-user/
default-deny), 3 Medium (сироты `speaking_audio_event` → явный cleanup; утечка
fixture-корней при частичном посеве → аккумулятор наружу; ложный anon-deny при
битом ключе → owner positive control доказывает валидность клиентского ключа),
1 Low (наследование env из shell → валидация присутствия в файле). Осознанно
оставлены: cleanup-ошибка не краснит итог (best-effort, уникальные имена);
negative-проба трактует любую HTTP-ошибку как deny (митигировано positive control).

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
- **3a (закрыта 2026-07-20):** login/session, reading autosave/reload/submit, full mock iframe, cap-граница;
- **3b (закрыта 2026-07-20):** writing, speaking, admin publish-путь, vocabulary;
- **3c (после 0b):** payment sandbox E2E.

**Волна 3b (2026-07-20, поверх инфры 3a).** +4 спека (сьют 10→15 тестов), ×5 полных
прогонов зелёные (14 passed + 1 quota-skip). Ключевые решения:
- **W/S без LLM и без прода:** раннер включает фичи (`NEXT_PUBLIC_SITE_URL=
  http://localhost:3000` — живой baseURL прогона, signup-редирект корректен) +
  фейковые GEMINI/internal-секреты; undici-preload жёстко рубит любой запрос на
  `/api/{writing,speaking}/evaluate` ДО DNS/сокета (интерцептор по пути, Codex-high) —
  submission детерминированно остаётся pending; «завершённый эвал» инжектится
  сид-хелперами (`injectCompleted{Writing,Speaking}Feedback` — транзакция +
  guarded-update из transient-статусов, speaking ещё и `delete_requested_at IS NULL`),
  result-UI ассертится на инжектированных band/фидбеке. Реальный Gemini и прод
  недостижимы ПО КОДУ (строка `BLOCKED outbound evaluate call` в dev-логе — ожидаемая).
- **speaking:** реальная запись fake-микрофоном (непрерывный WAV-тон 440Гц через
  `--use-file-for-fake-audio-capture` — синтетический бип флакал на silence-гейте),
  12с (MIN_SECONDS=10), реальный Storage upload/cleanup на тест-стенде, delete-флоу
  реальный; отдельный ultra-юзер (preview-лимит premium недетерминирован для повторов).
- **admin:** сид кладёт draft-клон atomized-фикстуры; спек — review → publish через
  реальный /admin UI → тест виден в каталоге; негатив: не-admin редиректится (толерантный
  паттерн `/app(\/|$|?)` — не-onboarded аккаунт уезжает вторым хопом на онбординг).
- **vocab:** сид-дека 3 карты + due-строки + saved_word; полная review-сессия по UI
  до «Session complete», «My words» с контекстом.
- **троттл:** сьют делает ~13 логинов при лимите 10/10мин — `loginAs` чистит
  `signup_throttle` перед каждым логином (прод-защита не предмет e2e, юниты её держат).

**Инфра волны 3a (2026-07-20).** Stateful-сьют переведён с прод-БД на hosted тест-стенд:
`npm run test:e2e:stateful` (`scripts/run-stateful-e2e.ts`) — env из `.env.test.local` через
`loadTestTargetEnv` (fail-fast на прод-ref) + ALLOW_STATEFUL_E2E=1; `e2e/seed.ts` —
идемпотентный сид (атомизированный reading-item 5Q, синтетический runner-item с
bridge-submit, smoke-юзер premium + cap-юзер basic, cleanup-хелперы, чистка
signup_throttle на старте). Негативный контроль: без тест-env global-setup блокирует
сьют ДО касания БД (доказано прогоном). Codex-ревью волны: **BLOCKER закрыт** — гейт и
admin-провижининг читали РАЗНЫЕ env-каскады (прод-`.env.local` + тест-`.env.development.local`
= юзер создавался бы в проде); теперь один resolved-объект `loadE2eEnv()` питает гейт И
всех потребителей кредов; +3 находки (обязательный `NEXT_PUBLIC_SUPABASE_ANON_KEY` в
`.env.test.local`, чистка троттла, cap-ассерты без гонки с client-side `replaceState`).
**Сетевой урок стенда (диагностика с уликами pg_stat_activity):** локальный dev ↔
eu-central непригоден на обоих пулерах Supavisor — transaction (:6543) стопорится посреди
протокола (Client/ClientRead до 300s, ~50% зависонов /app/practice), session (:5432)
упирается в pool_size=15 (EMAXCONNSESSION); e2e-раннер подключает БД НАПРЯМУЮ
(`db.<ref>`, IPv6-only, без клиентского лимита) — прод-конфиг (:6543) не тронут, там
один регион и short-lived инстансы. Плюс undici-preload (`scripts/e2e-undici-resilience.mjs`):
короткое keep-alive окно против ECONNRESET на протухших сокетах fetch (ретраи убраны
сознательно — RetryAgent ломал POST-тела и маскировал 429 квоты в «fetch failed»).
Стабилизация: **×5 полных прогонов подряд зелёные** (9 passed + 1 skipped, ~110с/прогон).

Runbook прогона (ручной, НЕ в CI — по образцу §7):
1. Dashboard `ielts-test`: если paused — Restore, дождаться healthy;
2. один прогон за раз (фикстуры/аккаунты общие — параллельные запуски конфликтуют);
3. `npm run test:e2e:stateful` (сид + троттл-чистка внутри; порт :3000 должен быть
   свободен — зомби-`next` убить по гоче CLAUDE.md);
4. signup-тест может дать skip: встроенная почта Supabase на тест-проекте (кастомный
   SMTP только на проде) даёт ~2-4 письма/час — skip по квоте штатен, любая другая
   ошибка формы красная;
5. часы машины держать в NTP-синхроне (дрейф >1с даёт разовые `JWT issued at future`).

Полный целевой список из аудита:
- [ ] signup → подтверждение email → onboarding → dashboard (частично: форма signup
      покрыта старым спеком; email-цепочка — вне автоматики, см. нюанс ниже)
- [x] login → logout → session protection (`e2e/auth.spec.ts`, 2026-07-20; password
      reset — отдельный незакрытый пункт ниже)
- [ ] password reset → callback → новый пароль
- [x] reading practice: ответы → autosave → reload → resume → submit → разбор
      (`e2e/reading.spec.ts`: реальный debounce-автосейв 1.5с ловится по POST server
      action, reload восстанавливает значения контролов, счёт 3/5 согласован с ответами)
- [x] full mock через iframe: bridge/postMessage → submit → result
      (`e2e/mock-iframe.spec.ts`: sandbox РОВНО `allow-scripts allow-modals`, CSP
      runner-роута `default-src 'none'`+`connect-src 'none'`, синтетический runner_html
      шлёт канонический `{type:"ielts-submit"}` → грейд 2/2; таймер — вне синтетики)
- [ ] listening: старт аудио, пауза, resume, переходы частей (ждёт заливки аудио)
- [x] Basic cap на границе лимита (`e2e/cap.spec.ts`: limit−1 проходит в раннер,
      граница блокирует с видимым баннером; счётчик подводится сид-хелпером
      `preloadPracticeStarts`, cleanup в afterAll)
- [x] vocabulary review + saved words (`e2e/vocab.spec.ts`, 2026-07-20)
- [x] writing: store → polling → result (`e2e/writing.spec.ts`; evaluation = DB-инжект,
      реальный LLM вне E2E по дизайну — см. блок 3b выше)
- [x] speaking: permission → запись → upload → polling → result → delete
      (`e2e/speaking.spec.ts`; evaluation = DB-инжект, там же)
- [x] admin review → publish → каталог (`e2e/admin-import.spec.ts`; сам импорт
      CLI/Telegram — вне браузерного сьюта, сид кладёт draft напрямую)
- [ ] payment sandbox (после 0b, 3c)

Устройства — ручной release-гейт (короткий чек-лист + фиксация прохождения):
- [ ] реальный iPhone Safari; реальный Android Chrome
- [ ] аудио, touch, клавиатура, scroll, orientation

Существующее: `e2e/smoke.spec.ts` (4 сценария; с волны 3a бегает против тест-стенда
через тот же stateful-раннер). `_mobile_gate.ts` (gitignored, одноразовый) удалён
2026-07-20 — устройственный чек-лист остаётся ручным гейтом, версионируемый формат
за подволной устройств.

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
- [~] real import fixtures: ЧАСТИЧНО закрыто 2026-07-21 — committed синтетическая
      golden-фикстура канона «Inspera Style» (`runner/fixtures/reading-inspera.html`,
      16Q × 8 типов, делегирующая band-цепочка, `.analysis`-блоки) + интегральные
      describe в parse-runner/parse-reading-full (гоняются всегда, в т.ч. CI).
      4 skipped-теста реальных образцов остаются (parse-test:216 Tuatara/Banff —
      другие формы, parse-reading-full:328 full-template, parse-listening:282);
      триггер прежний — ритмичный контент-поток от клиента
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
| PR-flow + required checks (мягкая protected branch на main УЖЕ включена) | второй человек в репо / внешние контрибьюторы / compliance |
| Полный E2E-набор §9 + payment sandbox E2E | мерчант подключён |
| Component tests / visual regression | редизайн, дизайн-система или частые UI-регрессы |
| Load/k6, Lighthouse CI гейты | платящие юзеры / >1-2k MAU |
| A11y-автоматика | партнёрства (школы) или жалобы |
| Mutation testing, ZAP | зрелость/команда/выручка |
| ~~GitHub secret scanning / CodeQL~~ ✅ ВКЛЮЧЕНЫ 2026-07-20 (репо публичный → бесплатно) | — сработал |
| Nightly-контур (полный E2E, 3 браузера, контракты, fuzz) | когда есть что гонять ночью (после волн 2-3) |
| Мобильная browser-matrix (WebKit/Firefox) | только width-зависимое; touch остаётся за реальным устройством |

## 13. Анти-цели (сознательно НЕ делаем)

- НЕ вводим PR-flow/церемонию для соло — сам себе разрешать merge бессмысленно.
- НЕ строим jsdom-тесты на ExamRunner/iframe — тестирование моков браузера, не продукта.
  (Уточнение 2026-07-21: jsdom появился в devDeps ТОЧЕЧНО для DOM-теста инжектируемого
  `bridge.__collect` (`bridge.test.ts`) — это чистый браузерный скрипт-коллектор, не
  React-компонент; анти-цель на компонентный jsdom остаётся в силе.)
- НЕ считаем Playwright-эмуляцию доказательством touch-поведения.
- НЕ фальсифицируем Supabase тестами, которые проверяют только PostgreSQL (границы
  честно помечены: PostgREST/Auth/Storage → волна 2).
- НЕ гонимся за 90-100% coverage и «3000 тестов» — только риск-взвешенные проверки.
- НЕ держим test-проект Supabase искусственно бодрым (keep-alive) — ручной resume.

## 14. Статус

| Волна | Статус | Сессия |
|---|---|---|
| Тестовая волна юнит-покрытия + 4 прод-фикса | ✅ закрыта | 2026-07-19 (`6a85762..72a2365`) |
| 0a платёжные инварианты (0a-unit + 0a-db) + 3 прод-фикса (stack-race FOR UPDATE, reconcileClaims, grant-guard) | ✅ код закрыт; test-target заведён (2026-07-20) | 2026-07-19 |
| 1 CI-фундамент | ✅ закрыта | 2026-07-19 (`81acc4d..cdb8ca6`) |
| 1.5 native-PG данные/гонки + прод-фиксы 0056/0057 (grant-lockdown) | ✅ закрыта | 2026-07-19 (`3487a13..0b96658`) |
| 2 hosted Supabase контракты | ✅ закрыта (test-target заведён, миграции+постура+IDOR через реальный PostgREST+Auth+Storage; payment webhook по дизайну в 0b) | 2026-07-20 |
| 0b sandbox-окно | ⬜ ждёт ключей | — |
| 3a браузер: stateful-сьют на тест-стенде (раннер+сид+auth/reading/mock-iframe/cap, Codex-BLOCKER env-каскада закрыт, ×5 зелёные) | ✅ закрыта | 2026-07-20 |
| 3b браузер: vocab/admin-publish/writing/speaking (сьют 15 тестов, W/S без LLM — DB-инжект, ×5 зелёные) | ✅ закрыта | 2026-07-20 |
| 3c payment E2E (после 0b); устройства — ручной гейт | ⬜ по триггерам | — |
| 4 эксплуатация | ⬜ по триггерам | — |
| Парсинг-трек «Inspera» вне волновой сетки: сьют 1575→1662 (import 485+), golden-фикстура канона, jsdom DOM-тест bridge, ad-hoc live e2e на проде (import→publish→Playwright mock 40/40→уборка); CI-инцидент: `npm audit` гейт покраснел на транзитивной brace-expansion (high) от jsdom → закрыт non-breaking `npm audit fix` (`a213274`); оставшиеся moderate (drizzle-kit/next) ниже гейта | ✅ закрыт | 2026-07-21 (`7781435..a213274`) |
