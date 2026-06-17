# WORKLOG — ЧИТАТЬ ПЕРВЫМ ДЕЛОМ В КАЖДОЙ СЕССИИ

Ты — инженер этого проекта (IELTS-платформа). Этот файл — единственная точка входа:
он говорит, **где мы, что закрыто и что осталось**. Прочитай его ЦЕЛИКОМ до любого
действия, найди первый незакрытый пункт и работай по нему. Источник правды по продукту/
стеку — `BRIEF.md` и `CLAUDE.md`, по неоднозначностям схемы — `SCHEMA_NOTES.md`
(этот файл их не дублирует, а ссылается).

---

## 1. ЖЁСТКИЕ ПРАВИЛА (нарушение = откат)

- **НИЧЕГО НЕ ЛОМАТЬ.** Поведение grading / submit / RLS / tiers / рейтинга остаётся
  идентичным. Любой пункт, который это задевает, проверяется сверкой score «до/после».
- Один пункт = один подтверждённый шаг. **Перед началом пункта — показать план и ждать
  «делай». Перед любым деплоем/пушем — ждать «делай».** Не делать всё скопом.
- Стиль строго по проекту: inline-стили + CSS-токены (`app/tokens/*.css`), без Tailwind/
  CSS-in-JS. **Ноль новых runtime-зависимостей** (`package.json` не трогать).
- Комментарии и общение — на русском; идентификаторы/коммиты — на английском.
- Коммиты БЕЗ любой AI-атрибуции (ни `Co-Authored-By`, ни «Generated with»). Гранулярно,
  по одному пункту.
- Изменения схемы БД — ТОЛЬКО миграцией `migrations/NNNN_name/{up,down}.sql` в lockstep
  со `src/db/schema.ts`; `down.sql` обязан откатывать (см. правила миграций в `CLAUDE.md`).
- Верификация: `npx tsc --noEmit` + `npm run build`. `npm run build` **НЕ гонять при живом
  `npm run dev`** (затрёт `.next` → 500). `npm run verify` — DESTRUCTIVE, только локальный
  docker, **НИКОГДА на Supabase**.
- Dev на Windows: `TaskStop` не убивает `next` → зомби на :3000-3002. Проверять реальный
  порт из лога и смотреть страницу в **реальном браузере** (fetch-проба HTML стили не доказывает).

---

## 2. ГДЕ МЫ СЕЙЧАС

<state>
Дата последнего обновления: 2026-06-17
Инфраструктура: Vercel-функции и Supabase ОБА во Франкфурте (Vercel fra1 ↔ Supabase eu-central-1).
  Это закрыло главный лаг (запросы летали через Атлантику US↔EU). НЕ ТРОГАТЬ.
Активная фаза: perf-доработка, 11 пунктов ниже. После них — фаза дизайна (раздел 4).
Закрыто пунктов: 11 / 11. ✅ Perf+security фаза закрыта.
E2E прогнан на проде (2026-06-17): реальный submit → grade 8/13 [6], applyPostSubmit rated Δ3 [2],
  recompute → leaderboard rank=1 [2], rating 1000→1003/xp→18; каталог список+фильтры+счётчики [4];
  region self-join Navoiy←Uzbekistan [7]. Все поведенческие дыры закрыты машинно.
Сейчас в работе: SECURITY+CORRECTNESS трек (раздел 3c). P0 закрыт (0010 на Supabase + push, live).
  P1-3 и P1-4 закрыты. Дальше P1-5 (атомарность applyPostSubmit), затем 6 (опц.) и 7 (заметка).
Тестовая БД восстановлена после db:down-инцидента: 2 профиля (eleru340 = admin), 9 Reading + Full +
  Listening published, eleru340 имеет демо-attempt. (db:down = revert ALL — НЕ гонять на проде.)
</state>

---

## 3. ЗАДАЧИ — 11 ПУНКТОВ (порядок = приоритет)

Статусы: `☐` не начато · `🔄` в работе · `✅` закрыто (ставить дату + 1 строку что сделано).
Делать сверху вниз: видимый эффект → вырост → полировка.

### P1 — видимый отклик при кликах

- `✅ 2026-06-17` **[1] loading.tsx со скелетонами** (коммит `67b65f2`; призрак-шапка не мигает, tsc зелёный, визуал на Vercel ок) для всех роутов под `app/app/`: `page` (dashboard),
  `reading`, `listening`, `reading/[id]`, `reading/[id]/result`, `profile`, `leaderboard`,
  `badges`, `notifications`, `invite`, `upgrade`, + `app/admin`. Скелетоны в дизайне bando
  (те же токены/`Card`/радиусы/тени, что на странице), НЕ серые болванки.
  *Acceptance:* клик в `/app` мгновенно показывает скелет вместо «зависшего» старого экрана
  (проверить в браузере с CPU-throttle). *(опц.* `<Suspense>` вокруг «Weak areas»+«Recent tests»
  на dashboard — шапка рисуется сразу.)

### P2 — серверное время submit (важно на росте)

- `✅ 2026-06-17` **[2] recomputeLeaderboard → из синхронного submit в фон.** (Next `after()` в `submitAttempt` при rated; champion-бейдж теперь синхронно через прямой rating-запрос — поведение идентично; tsc+build зелёные)
  `src/lib/progress/leaderboard.ts:137`, вызов в `src/lib/progress/apply-post-submit.ts`.
  Не пересчитывать весь лидерборд на каждый rated-submit синхронно (после ответа клиенту /
  инкремент / cron). *Acceptance:* `submitAttempt` отвечает, не дожидаясь rebuild; лидерборд
  всё равно сходится (прогон submit→leaderboard на local docker).
- `✅ 2026-06-17` **[6] submit: убрать дубль `gateAccess` + распараллелить независимые SELECT.** (`gateAccess`→`loadAccessData`+`enforceAccess`; throttle/access/answer-key через `Promise.all`; `content_item` один round-trip; порядок проверок и score идентичны; tsc+build зелёные)
  `app/app/reading/[id]/actions.ts` (`gateAccess` зовётся в `ensureAttempt:79` и `submitAttempt:242`;
  цепочка attempt/throttle/answer_key/contentItem идёт водопадом). *Acceptance:* score до/после
  совпадает на тестовой попытке.

### P3 — индексы БД (страховка на вырост)

- `✅ 2026-06-17` **[3] миграция `0008`: индексы.** (partial `attempt(user_id,submitted_at) WHERE submitted` + `notification(user_id) WHERE read_at IS NULL`; `user_badge` пропущен — PK `(user_id,badge_id)` уже покрывает; применено к Supabase, `EXPLAIN` forced → Index Scan / Index Only Scan) `attempt(user_id, status, submitted_at)`
  [можно partial `WHERE status='submitted'`], `notification(user_id) WHERE read_at IS NULL`,
  `user_badge(user_id)` (если нет). Сверить с уже существующими в `migrations/*/up.sql`, не
  дублировать; обновить `schema.ts` в lockstep. *Acceptance:* `EXPLAIN` горячих запросов
  (recompute, computeStats, unread-count) на засеянном local docker — index scan, не seq scan.

### P4 — каталог из кэша + мелкие waterfall'ы

- `✅ 2026-06-17` **[4] каталог `force-dynamic` → кэш (ISR/`unstable_cache`).** (`getPublishedTests` через `unstable_cache`+Drizzle owner, тег `content_item`; фильтр/счётчики в памяти, 2 запроса→1 кэш-хит; admin publish/upload инвалидируют тег; tsc+build зелёные) `app/app/reading/page.tsx`,
  `app/app/listening/page.tsx` — список published-тестов меняется редко; per-user tier-лок
  оставить отдельно. *Acceptance:* повторный заход не делает повторный запрос к `content_item`;
  фильтры по category/q_type работают.
- `✅ 2026-06-17` **[7] распараллелить waterfall'ы.** (`_AppShell` profile+notif → `Promise.all`; leaderboard own+parent → один self-join (alias); `_CatalogView` покрыт [4]; tsc+build зелёные) `app/app/_AppShell.tsx:25` (profile+notif count),
  `app/app/_CatalogView.tsx:59` (2 запроса `content_item`), `app/app/leaderboard/page.tsx:49`
  (region+parent). *Acceptance:* те же данные, меньше последовательных await (через `Promise.all`).

### P5 — клиентский бандл / полировка

- `✅ 2026-06-17` **[5] `posthog-js` динамический импорт** (lazy `import()` в `analytics/client.ts`; убран неиспользуемый `posthog-js/react`-контекст; identify под `analyticsOn`-гейтом; posthog только в lazy-chunk — проверено `posthog=False` в shared; tsc+build зелёные) в `src/lib/analytics/provider.tsx:5` (−~40 КБ из бандла).
  *Acceptance:* аналитика работает при заданном ключе, no-op без ключа; бандл меньше.
- `✅ 2026-06-17` **[8] `React.memo` на список вопросов в `ExamRunner.tsx`** + `useCallback` на сеттеры —
  ввод одного ответа не перерендеривает все вопросы. *Acceptance:* ответы/автосейв/сабмит работают как раньше.
  **Уже реализовано в redesign quality pass** (`QuestionBlock = memo` `:253`, `set`/`flag` `useCallback` functional-setState deps=[] `:94-95`, в `.map` стабильные `onAnswer`/`onFlag`). Проверено, кода не трогали.
- `✅ 2026-06-17` **[9] Drizzle pool:** (`max: 10`, `idle_timeout: 20`, `connect_timeout: 10` — обоснованы под serverless+pgbouncer; реальный коннект к Supabase проверен `db.execute(select 1)` throwaway-пингом) `src/db/index.ts:14` — добавить `max` и `idle_timeout` (надёжность на пике).
  *Acceptance:* приложение коннектится, `npm run verify` зелёный.
- `✅ 2026-06-17` **[10] `<img>` → `next/image`** (CLS уже был предотвращён `width/height` + CSS `.fcard img` fixed 72×72; локализовал 4 CDN-эмодзи в `public/emoji/`, убрал внешний jsdelivr fetch — вид и зарезервированный бокс сохранены; tsc+build зелёные) на лендинге `app/page.tsx:551-575` (эмодзи-иконки) или локальные
  SVG с явными `width/height` (фикс CLS). *Acceptance:* лендинг не дёргается при загрузке картинок.

### Отдельно (безопасность, НЕ perf — не смешивать)

- `✅ 2026-06-17` **[11] RLS на `public._migrations`** (миграция `0009`, `ENABLE RLS` без политик — owner-мигратор bypass'ит, anon без доступа; применено к Supabase, `db:status`/`migrate` работают; коммит `76ac660`). Supabase Advisor флагнул. Включить через миграцию.
  *Acceptance:* Advisor больше не показывает это; миграции продолжают применяться.

---

## 3c. SECURITY + CORRECTNESS findings (новый трек, порядок = приоритет)

Подтверждённые по коду находки (file:line реальные). Порядок: security → лаг → корректность.
Каждая группа = подтверждённый шаг (scope → «делай» → фикс → verify → коммит).

- `✅ 2026-06-17` **[P0] RLS write-lockdown** (профиль-эскалация + подделка счёта). Миграция
  `0010_profile_attempt_write_lockdown`: `REVOKE INSERT, UPDATE ON {profile,attempt} FROM
  authenticated` (RLS строчный, не колоночный → клиент мог PATCH-ить свою `profile.role`/
  `attempt.raw_score`). Легитимная запись идёт owner-путём (server actions), клиентских anon-
  записей в эти таблицы нет → revoke безопасен. RLS-тест в `verify.ts` (authenticated denied на
  role-patch и submitted-attempt-forge; owner-путь пишет). TDD: RED (тест ловил дыру) → GREEN.
  verify exit 0, tsc 0, vitest 93/93. **⚠️ НЕ применено к Supabase — ждёт «делай» на `db:migrate`.**
- `✅ 2026-06-17` **[P1-3] analytics блокирует клик** — `await captureServer` в test_start/
  test_submit ждал flush PostHog до 2с на user-facing пути → перенесён в `after()` (как
  leaderboard); в ensureAttempt в after() ушёл и meta-запрос (нужен только для props события).
  distinctId=user.id сохранён, capture best-effort. tsc 0, build зелёный.
- `✅ 2026-06-17` **[P1-4] mcq_multi нельзя ответить верно** — `ExamRunner`: answers
  `Record<string,string|string[]>`, `mcq_multi`→checkbox (toggle набора букв), single-choice→radio,
  completion→input; счётчик/навигатор через `isAnswered` (массив=непустой). `ensureAttempt`
  возврат расширен до `string|string[]` (resume). grade(mcq_set)/saveProgress/submit/result уже
  принимали массивы — не трогал. tsc 0, build зелёный, vitest 93/93. **Браузер-проверку MCQ — на Vercel.**
- `☐` **[P1-5] applyPostSubmit не атомарен** — read-modify-write xp/streak/rating → транзакция
  + SQL-инкремент.
- `☐ опц.` **[6] middleware getUser** — НЕ трогать без доказательства, что refresh токена не ломается.
- `✅` **[7] result-пересчёт по текущему answer_key** — уже задокументирован (RegradeRequiredError,
  full re-grade отложен); только сверка заметки, не фиксим.

---

## 4. ПОСЛЕ ВСЕХ 11 — ФАЗА ДИЗАЙНА

- `☐` Доработка дизайна (детали согласуем, когда дойдём). Mobile/responsive — отдельно
  (сейчас `/app` desktop-only, см. `CLAUDE.md`).

---

## 4b. ТЕСТОВАЯ ИНФРА (Vitest) — параллельный трек

Раннер: Vitest (devDep, в прод-бандл не идёт). Конфиг `vitest.config.ts` (env node,
co-located `src/**/*.test.ts`). Запуск: `npm test` (= `vitest run`) / `npm run test:watch`.
Жёсткое правило: unit — чистые, без I/O; integration — ТОЛЬКО локальный docker
(`VERIFY_DATABASE_URL`), НИКОГДА Supabase (прод недавно снесли `db:down`).

- `✅ 2026-06-17` **Волна 1 — чистая бизнес-логика** (62 теста, 6 файлов, зелёные; `tsc` 0).
  Покрыто: грейдинг `isCorrect`/`grade` (режимы mcq_set/text_accept/exact, нормализация,
  округление percent, защита от деления на ноль), Elo `expectedScore`/`ratingDeltas`
  (0.5 / симметрия / zero-sum / знак / округление / масштаб K), tiers `effectiveTier`
  (фейк-таймеры) / `meetsTier` / `hasFullReview`, `canonQuestionType`, `findPlan`, `scrubEvent`.
- `✅ 2026-06-17` **Волна 2 — импорт-парсеры** (+31 тест, всего 93; `tsc` 0).
  `extract-js` (балансировка скобок со строками, vm-изоляция: глобалы Node не видны + функция
  не пишет в реальный global, error→null), `parseTest`/`parseListening`/`parseFullReading` на
  inline-фикстурах (диспетчер, мета, XSS-санитайз пассажа, маршрут ключа exact/text_accept/mcq_set,
  инфер типов, band-шкала 0..40, question→passage). HTML-samples gitignored (§11) → НЕ коммитим;
  поверх реальных файлов — блоки `describe.skipIf(нет файла)` (Tuatara 14Q / Banff MCQ 13Q /
  listening 40Q·4 части / Full 40Q·3 пассажа): гоняются у владельца локально, скип в CI.
> Трек на паузе после волны 2 (решение владельца): цель — доказать корректность ядра —
> достигнута; RLS/триггер уже под гейтом `npm run verify` + E2E-прогон на проде (раздел 2).
> Волны ниже — ОПЦИОНАЛЬНЫ, поднимать ТОЧЕЧНО при изменении security-поверхности
> (новая RLS-политика / таблица / гейт).
- `☐ опц.` Волна 3 — integration на local docker (RLS / answer_key / изоляция attempt / идемпотентность submit).
- `☐ опц.` Волна 4 — e2e Playwright (login → exam → submit → result).

---

## 5. КОНТРАКТ СЕССИИ (что делать каждый раз)

1. Прочитать этот файл. Назвать пользователю: что закрыто, какой пункт следующий.
2. Показать план по следующему пункту (файлы + что меняю + acceptance). Ждать «делай».
3. Сделать пункт → verify по его acceptance → показать вывод команды.
4. Обновить раздел 2 (`<state>`: дата, «закрыто N/11», «в работе») и статус пункта в разделе 3
   (`☐`→`✅` + дата + 1 строка «что сделано»). Коммит.
5. НЕ начинать следующий пункт без подтверждения.

---

## 6. ПРИМЕР ОБНОВЛЕНИЯ СТАТУСА

<example>
Было:
  `☐` **[1] loading.tsx со скелетонами** ...
Стало (после закрытия):
  `✅ 2026-06-18` **[1] loading.tsx со скелетонами** — добавлены 12 `loading.tsx`,
  проверено в браузере с CPU-throttle, клики дают мгновенный скелет.
И в <state>: «Закрыто пунктов: 1 / 11», «Сейчас в работе: P2 [2]».
</example>

---

## 7. СТОП-УСЛОВИЯ (edge / failure)

- **`verify` / `tsc` / `build` упал** → СТОП, не пушить. Диагностировать причину (skill
  `debug-context`), починить, перепрогнать. После 2 неудач — доложить что пробовал, спросить.
- **Пункт задевает grading/submit/RLS/tiers** → СТОП до сверки score «до/после»; расхождение = откат.
- **Живой `npm run dev`** → не гонять `build`; для прод-замера убить dev → `rm -rf .next` → build.
- **Данных/файла нет или поведение непонятно** → не угадывать; спросить одним вопросом.
- **Любой риск необратимого** (force-push, reset --hard, drop) → предупредить и ждать «делай».
