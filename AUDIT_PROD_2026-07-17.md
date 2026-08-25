# Prod-readiness аудит 2026-07-17

## Вердикт: GO-WITH-CONDITIONS

0 CONFIRMED blocker. Изоляция данных доказана живой пробой (`SET ROLE anon`/`authenticated` с
подставным JWT → 0 чужих строк, INSERT с чужим `user_id` отбит RLS), все гейты зелёные
(`tsc` чисто, `npm test` 1412 passed, `build` OK, `verify` 37/37 на локальной throwaway-БД),
прод живой (`/api/health` → 200). Но независимо подтверждены **3 major-дефекта**: (1) исполняемый
restore-drill validator в runbook захардкожен на 34 таблицы при фактических 37 → корректное
восстановление валидного дампа даёт ложный `exit 1`; (2) штатный `npm run test:e2e` без единого
гейта пишет в боевую БД через service-role; (3) import-песочница `vm` эмпирически OOM-роняет
серверный процесс на враждебном/битом клиентском HTML. Ни один не ломает пользовательский runtime
напрямую, но все три реальны и составляют условия ниже. Этот отчёт замещает более раннюю
INCONCLUSIVE-версию: два её UNVERIFIED-пункта (RLS-blocker, прод-liveness) закрыты моими живыми
пробами, а major-находки перепроверены адверсариально с нуля.

## Условия (для снятия в GO)

1. **Restore-drill validator (major #1).** Заменить захардкоженную `EXPECTED_TABLE_COUNT = 34` в
   `docs/RESTORE.md` (сниппет `scripts/_restore-drill.ts`) на актуальное число 37 — лучше читать его
   динамически из `verify.ts::APP_TABLE_COUNT`, а не дублировать литералом; прогнать реальную
   репетицию восстановления актуального артефакта в одноразовой БД до `exit 0`. Заодно поправить
   прозаические «34» в `RESTORE.md:41,53` и шапку `SCHEMA_NOTES.md:7` (minor #9, тот же корень).
2. **e2e пишет в прод (major #2).** Загейтить пишущие спеки (`signup`/`smoke`/`global-setup` с
   service-role) за явный opt-in (напр. `ALLOW_STATEFUL_E2E=1` + проверка, что таргет — не прод-ref),
   по умолчанию — скип/отказ. Владелец уже осознанно принял этот tradeoff (комментарий в
   `e2e/smoke.spec.ts:4-8`) — условие не «построй staging», а «убери случайный выстрел в прод».
3. **import vm OOM (major #3).** Вынести исполнение импортированного JS (`extract-js.ts`
   `evalDataObject`/`extractFunctionTable`) в отдельный worker/child_process с жёстким memory-limit
   (`resourceLimits`) и уничтожением по превышению, чтобы OOM убивал только worker, а не серверную
   функцию; повторить adversarial import-suite. До фикса — не импортировать непроверенный HTML в
   пиковые окна; ручной `scripts/storage-orphans.ts` остаётся для чистки orphan-аудио (minor #4).

## Находки

Только CONFIRMED и PLAUSIBLE. Порядок: blocker → major → minor → nit.

| # | Severity | Area | Статус | Файл:строка | Суть | Как воспроизвести/проверить |
|---|---|---|---|---|---|---|
| 1 | major | infra / disaster-recovery | CONFIRMED | `docs/RESTORE.md:129-131,154-157,189-198` | Исполняемый restore-drill сниппет захардкожен `EXPECTED_TABLE_COUNT = 34`, `main()` делает `process.exit(1)` при несовпадении; факт — 37 таблиц. Корректное восстановление валидного дампа детерминированно даёт `[FAIL] expected 34, found 37` → `exit 1`; оператор в кризис читает это как «бэкап битый». Число устарело трижды в файле, последняя репетиция 2026-07-08 (до миграций 0051/0052/0054/0055). | Восстановить актуальный артефакт в throwaway-БД и прогнать сниппет из runbook: фактически 37, ждёт 34, `exit 1`. Данные при этом на месте. |
| 2 | major | tests / data-safety | CONFIRMED | `package.json:26`; `playwright.config.ts:11,23-30`; `e2e/global-setup.ts:6-8`; `e2e/admin.ts:6-45`; `e2e/signup.spec.ts:13-20`; `e2e/smoke.spec.ts:4-8,21-74` | Гейта `ALLOW_STATEFUL_E2E` в КОДЕ нет (grep: только в audit-доке). Штатный `npm run test:e2e` безусловно поднимает `npm run dev` на `.env.local` (прод-ref `oyecqbveatkolbqgfczq`), `global-setup` через service-role `admin.createUser`, `signup.spec` регистрирует реальный аккаунт, `smoke.spec` создаёт и submit-ит реальный attempt. Owner-acknowledged (комментарий `smoke.spec.ts:4-8`). | Статически по цепочке file:line выше; `.env.local` host = прод-pooler. НЕ запускать на проде — на disposable staging доказать отказ на прод-identity после добавления гейта. |
| 3 | major | import / availability | CONFIRMED | `src/lib/import/extract-js.ts:20,95-102,191-208`; `app/admin/actions.ts:26-36`; `src/lib/import/runner/parse-runner.ts:103,229`; `app/api/telegram/webhook/route.ts:187` | `vm.runInNewContext(..., {timeout:1000})` исполняет произвольный JS из HTML; `extractFunctionTable` ВЫЗЫВАЕТ извлечённое тело функции. `MAX_VM_INPUT=4MB` лимитирует только длину исходника, memory-cap нет. Эмпирически: 59-байтный аллок-цикл → `FATAL ERROR: heap out of memory`, exit 134, на ~155мс (быстрее timeout), `try/catch` не ловит. Достижимо через admin-upload и Telegram-import клиентского HTML. | Throwaway `node --max-old-space-size=256`: `vm.runInNewContext('const a=[];while(true)a.push(new Array(1e6).fill(0))',{},{timeout:1000})` → процесс умирает, не пойман. Timeout защищает только CPU-цикл. |
| 4 | minor | auth / anti-abuse | CONFIRMED | `app/auth/actions.ts:143-152` | `signUp` НЕ использует транзакционный `checkAuthThrottle` (тот обслуживает только login/reset); свой инлайн-путь `db.select → check → db.insert` без транзакции/лока — TOCTOU. Конкурентный burst с одного IP проскакивает velocity-cap на несколько лишних регистраций. Анти-абуз, не authz. | На staging: параллельный пакет signup с одного IP у границы cap, сравнить пропущенные с лимитом. Фикс — обернуть COUNT→INSERT в тот же `pg_try_advisory_xact_lock`, что уже есть для login/reset. |
| 5 | minor | import / storage | CONFIRMED | `src/lib/import/runner/import-runner.ts:108,121,126,139` | `uploadAudio` (внешний Storage) выполняется ДО `sanitizeRunner`/`assertNoKeyLeak`/`persistTest`; при их провале компенсирующего `.remove()` нет → orphan-объект. Известный принятый риск (ручной `scripts/storage-orphans.ts`). | Замокать успешный upload + провал persist; проверить отсутствие DB-строки и наличие orphan-объекта. |
| 6 | minor | cron / idempotency | CONFIRMED | `app/api/cron/error-digest/route.ts:53-74` | Авторизация fail-closed, но каждый повтор берёт то же скользящее 24ч-окно и переотправляет digest без claim/ledger/dedup-ключа. Авторизованный retry дублирует уведомление владельцу. | Integration-тест с mock-провайдером: вызвать джоб дважды на одном наборе строк → ожидать одну доставку. |
| 7 | minor | observability | CONFIRMED | `app/api/monitoring/client-error/route.ts:14-16,43-47`; `src/lib/monitoring/log-error.ts:30-53` | Публичные валидные POST забивают общую DB-квоту 120 client-events/60с; далее реальные клиентские ошибки молча получают 204/не пишутся. Серверные логи и Sentry (при DSN) не задеты — подавлен именно self-hosted client-sink. | На staging забить квоту синтетикой, проверить 204/отсутствие записи для следующего события. |
| 8 | minor | requirements / import | CONFIRMED | `src/lib/import/audio-cap.ts:15`; `BRIEF.md:523`; `CLAUDE.md` (Import pipeline) | Реализация и тест жёстко режут аудио >12 MB (`MAX_IMPORT_AUDIO_MB=12`), а BRIEF/CLAUDE заявляют cap 15 MB. Файл 12–15 MB валиден по спеке, но отклоняется. Более жёсткий кап безопаснее — исправить надо ДОК, не код. | `withinAudioCap(12*1024*1024+1)` → `false`; по BRIEF ждётся allow до 15 MB. |
| 9 | minor | docs-drift | CONFIRMED | `SCHEMA_NOTES.md:7,65-70` | Шапка файла утверждает «Table count: 34», а собственные поздние секции (`:855-856,917,966,974`) и `verify.ts:36` (`APP_TABLE_COUNT=37`, подтверждено живым verify) дают 37. Самопротиворечие внутри документа. Тот же корень, что major #1. | `grep "Table count" SCHEMA_NOTES.md` vs `grep APP_TABLE_COUNT scripts/verify.ts`. |
| 10 | minor | frontend / a11y | CONFIRMED | `src/components/app/AppHeader.tsx:106-127,131-138` | Desktop `NavLink` сообщает active-state только цветом+underline, без `aria-current`; мобильный `DrawerLink` корректно ставит `aria-current="page"` — несогласованность. Активная ссылка не объявляется screen-reader'у как текущая. | Authed staging + screen-reader/Accessibility Tree: desktop-nav активная ссылка не объявлена current. |
| 11 | minor | frontend / a11y | CONFIRMED | `app/app/reading/[id]/ExamRunner.tsx:2006-2023` | Панель `role="dialog"` "Session goal" без Esc-закрытия и без фокус-трапа/переноса фокуса; сосед `ReaderPanel` (`:2188-2195`) Esc имеет — непоследовательно. Не на ключевом пути (необязательная настройка). | Practice-раннер → чип "Goal" → Esc не закрывает (в отличие от reader-settings). |
| 12 | minor | dependencies | CONFIRMED | `package-lock.json` (`postcss@8.4.31`); `package.json:36` | `npm audit --omit=dev --audit-level=high` → 2 moderate advisory на прод-`postcss` (транзитивно через Next.js). Runtime-путь обработки недоверенного CSS через PostCSS не найден — уровень не повышен. | Повторить `npm audit --omit=dev --audit-level=high`; воспроизводится без правки lockfile. |
| 13 | nit | frontend / robustness | CONFIRMED (downgraded) | `app/app/page.tsx:48,96,291` | Три инлайн-агрегации дашборда читают leaf `per_type_breakdown` без null-guard (в отличие от `practice/page.tsx:224-229` и `aggregateWeakness`). Механика падения реальна ТОЛЬКО для `null`-leaf, но единственный писатель `grade()` (`src/lib/grading/grade.ts:76-96`) детерминированно пишет `{correct,total}`; прод-проба 40/40 строк well-formed. Недостижимо сейчас → defensive-nit, не major. | После любого будущего data-фикса `attempt.per_type_breakdown` прогнать `SELECT ... WHERE per_type_breakdown IS NOT NULL` и проверить каждый leaf на object+number. |
| 14 | nit | security / anti-abuse | CONFIRMED | `src/lib/anti-bot/turnstile.ts:18` | Turnstile-гейт signup fail-OPEN, когда ключи не заданы (документированный seam, как payments/analytics); на сетевой ошибке к Cloudflare — fail-CLOSED (не баг). В `.env.local` ключи пусты; статус на Vercel этим аудитом не проверялся (см. PLAUSIBLE). | `grep TURNSTILE .env.local .env.example`; `turnstileConfig()===null → return true`. |
| 15 | nit | infra / observability | CONFIRMED | `app/api/health/route.ts:7-12` | Health — чистый liveness, БД не пингует (by design, комментарий это фиксирует). При падении Supabase `/api/health` всё равно 200. | `curl /api/health` → 200 даже при мёртвой БД. Для readiness нужен отдельный DB-backed probe. |
| 16 | nit | docs / dead-config | CONFIRMED | `.env.example:120`; `src/lib/speaking/storage.ts:12` | `SPEAKING_UPLOAD_TTL_SEC` задокументирован (дефолт 60) и в дизайн-спеке, но нигде в коде не читается — `createSignedUploadUrl(path)` вызывается без TTL. Мёртвая env-переменная. | `grep -rn SPEAKING_UPLOAD_TTL_SEC src app` → 0 совпадений. |
| 17 | nit | docs / stale-comment | CONFIRMED | `app/api/speaking/evaluate/route.ts:16` | Комментарий `// ... > default 10s` устарел: реальный дефолт Vercel Hobby+Fluid — 300s. Сам `maxDuration=60` безвреден, неверно только обоснование. | vercel.com/docs → Duration limits, Hobby default 300s. |
| P1 | major (prob.) | infra / config | PLAUSIBLE | Vercel → Settings → Env Vars | 8 `NEXT_PUBLIC_*` НЕ должны быть Sensitive — Sensitive не инлайнятся в build → origin/ключ = null в рантайме. Проект уже наступал на это с `NEXT_PUBLIC_SITE_URL`. Read-only без дашборда не проверить; сайт функционирует → вероятно ок. | Владелец: в дашборде проверить, что все 8 паблик-ключей НЕ помечены Sensitive, особенно после редеплоя настроек. |
| P2 | major (prob.) | auth / UX | PLAUSIBLE | `app/auth/actions.ts:200-208`; Supabase Auth dashboard | Если Supabase «Confirm Email» ВЫКЛЮЧЕН, ветка оставляет уже авторизованного юзера на `/auth` с сообщением «письмо отправлено» вместо перехода в онбординг; если включён — ветка недостижима. | Владелец: проверить toggle в дашборде; на staging прогнать signup в обеих конфигурациях. |
| P3 | minor (prob.) | infra / observability | PLAUSIBLE | Telegram config на Vercel | Без `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ADMIN_IDS` крон `error-digest` тихо скипается (`{ok:true,skipped:true}`) — владелец не получает ежедневную сводку ошибок. Бот импорта живёт в проде → вероятно задано. | Владелец: подтвердить, что Telegram-креды заданы в прод-env. |

## OUT-OF-SCOPE

- **Merchant/платежи** (ключи, onboarding, paymentsLive, вебхук) — не аудировано. Проверено только,
  что при выключенных платежах код fail-closed (`src/lib/payments/index.ts:56-93`,
  `app/app/upgrade/actions.ts:57-67`): без ключей вебхук возвращает `false`/401, `initiatePayment`
  редиректит на `?error=unavailable` до создания pending-строки — включение не сломает и не выдаст
  платную фичу бесплатно.
- **Контент-данные** (наполненность каталога, качество/объём тестов, аудио, транскрипты) — не
  аудировано (клиент заливает). Import-ПАЙПЛАЙН в скоупе — см. major #3, minor #5/#8.

## UNAUDITED

- **Authenticated stateful UI-journeys** (login→onboarding→practice→submit→result, error/loading/empty
  на реальной сессии) — нет staging, а по прод писать запрещено условиями аудита. Статически код
  проверен (пустые состояния, error.tsx, null-guard'ы — чисто), но живой проход авторизованных
  экранов не выполнен.
- **Touch-gated мобильное поведение** — ни Browser-панель, ни Playwright не эмулируют
  `pointer:coarse`/`hover:none`; width-зависимое проверено статически, touch-ветки требуют реального
  устройства.
- **Состояния дашбордов Vercel/Supabase/Sentry** (фактические env-флаги, активность Sentry-событий,
  план/лимиты, тумблер Confirm Email) — нет read-only доступа; вынесено в PLAUSIBLE P1–P3.
- **Реальная репетиция восстановления бэкапа** — артефакты бэкапа существуют и проходят size-guard
  (workflow `.github/workflows/db-backup.yml` корректен), но фактический restore актуального дампа не
  прогонялся; именно его validator сломан (major #1).

## Проверено чистым

- **security / data-access** → живая проба `SET ROLE anon`/`authenticated` с подставным JWT: чужие
  `attempt`/`profile`/`payment` → 0 строк, INSERT с чужим `user_id` отбит RLS (несмотря на широкие
  default-priv гранты — барьер это политики, а не гранты). Hard-lock (`answer_key`,
  `attempt_review_snapshot`, `*_feedback_debug`): 0 грантов + 0 политик. Server-only (`signup_throttle`,
  `error_log`, `trial_claim`): гранты отозваны. Owner-таблицы: политики строго `user_id=auth.uid()`,
  ни одной widened/`USING(true)`. Колоночные гранты `content_item`/`question`: `runner_html`/служебные
  колонки не даны клиенту. `answer_key`/snapshot/`feedback_debug` в коде селектятся только Drizzle
  owner-путём, на клиент не уходят. Секретов в 69 `"use client"` файлах нет. `node:vm` устоял против
  10 escape-векторов (process/require/Function-chain/import() — все заблокированы) — RCE нет (но OOM
  есть, major #3). **Это замещает UNVERIFIED-blocker (RLS) более раннего аудита — не blocker.**
- **auth / session** → middleware fail-closed (`authed=false` при любой ошибке Supabase), matcher
  покрывает `/app` и `/admin`, исключённые роуты secret/HMAC-гейтятся сами. `requireUser`/`requireAdmin`
  читают роль из БД owner-путём (не из клиентского клейма), стоят первой строкой на всех admin-страницах
  и во всех 15 admin-actions. Open-redirect в `next` отсечён `safeNextPath()` (`//host`, `\`, CRLF).
  Reset/confirm-ссылки строятся только из `publicSiteUrl()`, не из Host-заголовка. Транзакционный кап
  (`startAttempt`: `SELECT FOR UPDATE` на profile до COUNT, порядок локов profile→content_item)
  закрывает гонку check-then-act на уровне БД; practice/mock считаются раздельно; UTC-окна без
  off-by-one; resume-лазейки нет; fail-closed. Unauth-смоук прода: `/app`→307 `/auth`, `/admin`→307,
  крон без Bearer→401, `/api/health`→200. **Прод-liveness подтверждён живым 200 — замещает
  UNVERIFIED-liveness более раннего аудита.**
- **backend / API** → owner-фильтр (`eq(userId)`/`.eq("user_id")`) присутствует во всех user-facing
  мутациях (annotation/saved-word/mistake/notification/speaking/writing/practice-actions); admin-actions
  зовут `requireAdmin` первой строкой; пустых fail-open `catch` в серверном коде нет (только в
  sandboxed-iframe фикстурах); `Date`-в-raw-`sql` не найдено (везде `.toISOString()`/`now()`/query-
  builder); `prepare:false` подтверждён на единственном клиенте. Кроны идемпотентны (snapshot-ranks —
  DELETE+INSERT в транзакции; vocab-reminders/expire-premium — dedup-ключ/idempotent WHERE) — исключение
  error-digest (minor #6). Все 8 кронов ≤ раз/день (Hobby-лимит соблюдён).
- **frontend / UX** → согласованность каталог↔раннер↔результат↔дашборд↔прогресс (общий `examHref`,
  капы из одной константы, `/reading`·`/listening`·`/leaderboard`·`/badges` — server-redirect'ы, не
  тупики). Осмысленные empty-states на всех списочных экранах (включая пустой вайпнутый каталог — не
  крашит). `error.tsx`/`global-error.tsx`/`not-found.tsx` покрывают дерево, шлют в Sentry+`error_log`;
  `loading.tsx` на тяжёлых роутах; malformed uuid → `notFound()` до БД. Responsive-инвариант соблюдён
  (брейкпоинт-свойства в CSS-классах, не inline). Публичные страницы (`/`,`/pricing`,`/about`,`/terms`,
  `/privacy`,`/auth`) — 200, корректные `<title>`, без сырых стеков.
- **infra / observability** → все 6 REQUIRED-env в `.env.example`; опциональные фичи graceful-degrade
  (Writing/Speaking/L1 → redirect; email/digest → no-op; payments/telegram/cron → fail-closed).
  `error_log`-путь не оборван (`log-error.ts` console+DB в try/catch, 39 серверных вызовов в catch);
  Sentry no-op без DSN (by design); client-error долетает до sink. Бэкап-workflow корректен (daily
  cron, size-guard ≥10KB, pin `postgres:17`, concurrency-guard); GitHub-API: последние 10 backup-run
  зелёные, свежий артефакт не expired. Storage: 39.6 MB из 1024 (3.9%), далеко от стены; audio-cap
  12 MB. Fluid 300s хватает на Gemini/импорт.
- **tests / гейты** → `tsc --noEmit` чисто; `npm test` 1412 passed / 4 skipped (грейдинг/анти-чит/
  парсеры/капы зелёные); `npm run build` OK (18/18 страниц, только некритичные warnings); `npm run
  verify` 37/37 OK на локальной throwaway-БД (все RLS/grant/health/auth-trigger ассерты прошли);
  `db:status` — все миграции по 0055 applied, pending нет.

---
*Замечание о качестве самого аудита: адверсариальная верификация опровергла дашборд-major (→ nit,
#13) и исправила ДВЕ ошибки моей же волны 2 — security-агент ошибочно счёл vm защищённым от OOM
(эмпирически опровергнуто, major #3), auth-агент спутал login/reset-throttle с signup-cap (последний
неатомарен, minor #4). Находки, не пережившие верификацию, в отчёт не включены.*
