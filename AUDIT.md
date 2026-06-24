# AUDIT.md — аудит проекта (2026-06-24)

Внешний аудит (Codex) → **построчно верифицирован по коду** в Claude Code. Все ссылки
`file:line` проверены, галлюцинаций нет. Severity ниже — **пересмотренные**; где расходится
с исходной оценкой Codex, помечено `(Codex: PN)`. Находки — открытые долги. Осознанно
отложенное вынесено в отдельный раздел (это принятые решения, НЕ баги).

> Порядок работы по находкам — по явной просьбе пользователя. Этот файл — реестр, не план.
> Ближайший порядок: (1) ✅ P0 iframe isolation закрыт и проверен на Vercel prod (2026-06-24,
> см. «Закрыто»); (2) ✅ Practice Hub реализован и проверен на Vercel prod (2026-06-24);
> (3) **текущая работа — открытые P2/P3 из этого реестра по приоритету.**

---

## Ближайший порядок работ

1. **✅ P0 закрыт (2026-06-24):** `/app/exam/[id]` runner_html изолирован в opaque origin
   (sandbox `allow-scripts allow-modals` без `allow-same-origin`) и проверен на Vercel prod.
   Детали — в разделе «Закрыто».
2. **✅ Practice Hub закрыт (2026-06-24):** верхние пункты Reading/Listening заменены единым
   `Practice` → `/app/practice`; Reading/Listening — живые входы в существующие каталоги,
   Writing/Speaking — честные `Coming soon` / Ultra-hook без разморозки Phase 3 AI. Continuation-герой
   (recommended/resume/first-test) сверху против «лишнего клика». Реализован, отревьюен (nav-состояние,
   RSC-границы, auth/тиры/scope — чисто), проверен на Vercel prod (commit `956d43c`).
3. **▶ Текущая работа — back to audit:** открытые P2/P3 ниже по приоритету, по одной находке (по
   явной просьбе пользователя).

Practice Hub был **не audit-багом**, а продуктовой IA-задачей — закрыт отдельным треком выше.

---

## Вскрыто аудитом: реальная exam-архитектура (ДВА раннера)

В проде сосуществуют два exam-пути — **незавершённая миграция**. Каталог маршрутизирует
по `content_item.runner_html IS NOT NULL` (`has_runner`):

```
_CatalogView.tsx:29 — examHref = has_runner ? `/app/exam/${id}` : `/app/reading/${id}`
```

- **`/app/exam/[id]`** (НОВЫЙ, целевой) — `app/app/exam/[id]/ExamFrame.tsx` (iframe) +
  `runner/route.ts`. Рендерит очищенный `runner_html` — оригинальный HTML теста. **P0 isolation
  закрыт:** sandbox `allow-scripts allow-modals` без `allow-same-origin`.
- **`/app/reading/[id]`** (LEGACY) — `app/app/reading/[id]/ExamRunner.tsx` + `src/components/exam/*`
  (`QuestionHtml`/`QuestionNavigator`/`ExamTimer`/`AudioPlayer`). Атомизированные вопросы
  (+ опц. verbatim `questions_html` из `passage`). Для тестов без `runner_html`.
- Оба сабмитят через общий `app/app/reading/[id]/actions.ts` (`ensureAttempt`/`submitAttempt`)
  и `result/`.
- `src/components/exam/*` — **не мёртвый код**, а компоненты отмирающего legacy-пути (живы,
  пока есть тесты без `runner_html`).

---

## Открытые находки

### P2 — слишком быстрый submit не исключается из рейтинга (Codex: P1)
- **Severity:** P2 — понижено. Integrity-фарм XP, не деньги/безопасность.
- **Где:** время считается сервером (`reading/[id]/actions.ts:333-336`, `timeUsedSeconds`), но
  `apply-post-submit.ts:116` рейтингует первую попытку по `count==1` **без взгляда на duration**.
- **Суть:** инстант-сабмит (старт → мгновенная сдача) идёт в rating/XP/streak/difficulty.
- **Почему P2, не P1:** уже частично кроется — velocity-throttle 5/60с (`src/lib/anti-cheat.ts:14-17`),
  rated только раз на тест (`count==1`), рейтинг растёт от `performance=rawScore/total` (мусорный
  быстрый сабмит даёт низкий score → поднимает в основном XP/streak, не рейтинг).
- **Предложение:** floor-guard перед rated — `timeUsedSeconds < N` (относительно `durationSeconds`/
  кол-ва вопросов) → `unrated`, опц. флаг для review. Дёшево.
- **Статус:** open. Примечание: на result-странице уже есть guard на отображение абсурдного времени
  (`result/page.tsx:159`, `timeReliable`) — но это про вывод, не про rating.

### P2 — Telegram-аудио привязывается к последнему Listening-тесту
- **Severity:** P2 — minor (admin-only поток, низкая частота).
- **Где:** `app/api/telegram/webhook/route.ts:178-183` — `handleAudioUpload` выбирает
  `contentItem where section='listening' order by createdAt desc limit 1`.
- **Суть:** mp3 привязывается к ПОСЛЕДНЕМУ listening-тесту, не к конкретному. Два админа /
  повторная загрузка / задержка → аудио уедет к чужому тесту.
- **Предложение:** pending-mapping `chat/admin → content_item_id`, либо reply/callback к
  конкретному тесту, либо explicit id в потоке.
- **Статус:** open.

### P2 — percentile считает все attempts И самого пользователя
- **Severity:** P2 — minor (продуктовая метрика).
- **Где:** `app/app/reading/[id]/result/page.tsx:92-99` — `count(*) where contentItemId AND status='submitted'`;
  UI «of other students» (`:174`).
- **Суть:** percentile считает ВСЕ submitted-попытки по тесту, включая ретейки **и текущего
  пользователя** (нет `userId != user.id`, нет «первая попытка на юзера»). Сравни: лидерборд для
  анти-фарма уже берёт первую попытку на `(user, test)`.
- **Предложение:** считать по первой submitted-попытке каждого юзера, исключив текущего из
  «other students». Показывается при `total >= 5` (`:169`).
- **Статус:** open.

### P3 — SCHEMA_NOTES фиксирует «13 tables», реально 16
- **Severity:** P3 — minor (schema governance / verify-count).
- **Где:** `SCHEMA_NOTES.md:7,14` («Table count: 13»). Реально в `src/db/schema.ts` — **16** `pgTable`:
  +`leaderboard_snapshot` (`:424`), +`annotation` (`:452`), +`payment` (`:521`) сверх карты.
- **Предложение:** обновить счётчик + «post-Phase additions», связать каждую новую таблицу с миграцией.
- **Статус:** open.

---

## Закрыто

### P2 — Listening-result ведёт drill-ссылками в Reading-каталог
- **Severity:** P2 — minor UX.
- **Было:** `app/app/reading/[id]/result/page.tsx` — `practiseHref` и все «Drill»/«Start»/«Back to
  catalog» CTA захардкожены на `/app/reading?q_type=...`. Result-роут общий для обеих секций, поэтому
  после Listening-теста дрилл-ссылки уходили в Reading-каталог (где listening-типов нет).
- **Закрыто:** 2026-06-24 — в `ci`-выборку дотянут `content_item.section`; выведен `catalogBase`
  (`/app/${section}`), на него переведены все catalog/drill-ссылки + `AppShell active` (теперь
  секционный; в навигации всё равно подсвечивает Practice). «Try again» → `/app/reading/${id}`
  оставлен как есть — это runner-routing (has_runner), отдельный долг, не секционный base path.
- **Не трогали:** grading/percentile/answer_key, `InsightReport`, submit/runner. tsc + build чисто.

### P2 — draft-тест доступен по прямому owner-пути `/app/exam/:id` (Codex: P1)
- **Severity:** P2 — defense-in-depth (понижено с Codex P1: эксплойт требовал знать UUID
  draft-теста, а каталог отдаёт только published → канала утечки id нет).
- **Было:** owner-путь (Drizzle, в обход RLS) читал `content_item` по `id` без `status='published'`
  в трёх точках старта/сервинга — `app/app/exam/[id]/page.tsx`, `runner/route.ts` и `loadAccessData`
  (`app/app/reading/[id]/actions.ts`, общий гейт старта+сабмита). Юзер с UUID неопубликованного теста
  мог открыть его и создать attempt. Legacy `/app/reading/[id]` дыры не имел — читает через
  anon-клиент под RLS `content_item_select_published` (migration `0001_rls:45`).
- **Закрыто:** 2026-06-24 — во все три owner-чтения добавлен `eq(status,'published')` (паритет с
  RLS-политикой и каталогом `getPublishedTests`). Draft → `notFound()`/404 на exam-странице и
  runner-route; `loadAccessData` → null → redirect, attempt не создаётся и не грейдится. Happy-path
  published-теста без регресса; tier/auth-гейты не тронуты. tsc + build чисто.
- **Не трогали:** legacy reading-страницу (уже RLS-safe), grading/answer_key/rating, значения тиров.

### P0 — `runner_html` исполнялся same-origin с широким CSP
- **Severity:** P0 (Codex: P0) — единственная настоящая security-дыра в списке.
- **Было:** `ExamFrame.tsx:34` `sandbox="allow-scripts allow-same-origin allow-modals"` +
  `runner/route.ts` CSP `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:`.
  `allow-scripts` + `allow-same-origin` = снятый sandbox: JS чужого HTML-теста исполнялся в нашем
  origin внутри авторизованной `/app` (supply-chain: захват сессии через `window.parent` /
  credentialed-запросы). Отход от BRIEF §4.2 ради fidelity.
- **Закрыто:** 2026-06-24 — раннер вынесен в **opaque origin** (sandbox `allow-scripts allow-modals`,
  без `allow-same-origin`). Сопутствующие изменения контракта (threat-model verdict:
  sound-with-required-mitigations):
  - `ExamFrame.tsx` — приём сабмита по идентичности окна `e.source === iframe.contentWindow`
    (+ null-guard) вместо `e.origin` (в opaque origin === `"null"`, плюс `"null"==="null"` — известный обход).
  - `bridge.ts` — SEND `targetOrigin` `window.location.origin` → `'*'`; +`retargetBridgeOrigin()`
    read-time чинит legacy-ряды БД (запечённый `window.location.origin` → `postMessage(d,"null")`
    бросает, сабмит молча терялся).
  - `scope-storage.ts` → `runner-storage.ts` — per-user namespacing-шим заменён in-memory
    Storage-полифилом (в opaque origin нативный Web-Storage бросает SecurityError; namespacing не
    нужен — общего персистентного хранилища между аккаунтами нет). Цена: resume между перезагрузками
    потерян (осознанно; у iframe-трека и так нет server-autosave, spec §5; reading `loadState` рано
    выходит на `null`).
  - `runner/route.ts` — CSP deny-by-default: `default-src 'none'`, `connect-src 'none'` (главный
    анти-эксфил-винт), без `'unsafe-eval'` (фикстуры eval не используют), `media-src` пин на Supabase
    Storage, `style/font-src` вайтлист cdnjs (FontAwesome) + Google Fonts.
  - Sandbox-токены, которые НЕЛЬЗЯ возвращать: `allow-same-origin`, `allow-top-navigation*`,
    `allow-popups*`, `allow-forms`, `allow-downloads`.
- **Верификация:** `npx vitest run` — 196 passed (+`runner-storage.test.ts` гоняет полифил в
  симулированном opaque-window: no-throw + Storage-семантика; +`bridge.test.ts` на retarget/идемпотентность/
  скоупинг), `npx tsc --noEmit` чисто. CSP-хосты сверены с фикстурами (внешний html2pdf-скрипт
  вырезается санитайзером; единственная внешка — cdnjs FA + Google Fonts; listening-аудио переписано
  на Supabase). **Live Vercel prod acceptance 2026-06-24:** Reading
  `/app/exam/b910fd84-6a30-4e9c-9383-c25d8cecbdbb` и Listening
  `/app/exam/4c834f23-873b-4a9a-be04-0ed90cefa996` оба отдают iframe sandbox
  `allow-scripts allow-modals`; parent не читает iframe DOM (`parentCanReadIframeDOM=false`);
  runner-контент рендерится; console `error/warning` пустые; Listening audio доходит до `Ready to play`
  и `Audio is Playing`; ручной smoke подтвердил Reading submit → result и Listening submit → result.
- **Остаток (не дыра):** CSP-вайтлист хостов выведен из 2 текущих шаблонов (Reading-Full + Listening);
  импорт теста из нового источника с другой внешкой будет CSP-заблокирован (видимый сбой, не утечка) —
  расширять вайтлист при появлении нового шаблона.

### P2 — документация описывала несуществующую/неполную картину (Codex: P3)
- **Severity:** P2 — поднято. Доки дезориентируют каждую сессию (дороже косметики).
- **Где:** `CLAUDE.md` (1) «no test runner» — неверно, vitest есть (`package.json`, `npm test`);
  (2) exam-секция описывала только компонентный `ExamRunner`, молчала про iframe-путь и P0.
- **Закрыто:** 2026-06-24 — CLAUDE.md сжат и обновлён: активный трек AUDIT.md, exam-архитектура,
  test-runner, P0 iframe и порядок работы по аудиту.

---

## Осознанно отложено (принятые решения, НЕ баги)

Codex корректно НЕ выдал их за «забыли» — реестр для пересмотра приоритета, не долги.

- **HMAC-подпись вебхука оплаты** — placeholder до merchant-ключей (`SCHEMA_NOTES` «Phase 2D»,
  `CLAUDE.md` payment-секция). **Перед реальными платежами — launch-blocker.** Риск снижен: грант
  выводится из доверенной `pending`-строки, не из тела запроса.
- **Anti-bot / email-verify на signup** — Turnstile code-seam готов (`src/lib/anti-bot/`, fail-open),
  ждёт Cloudflare-ключей. Связан с referral-farming + paid tiers.
- **Student Telegram-бот / weekly digest** — отложено (W1-5b): нужен отдельный бот-токен + scheduler +
  image-стек. Для UZ-аудитории — сильный retention-канал.
- **Premium audio signed URLs** — помечено low, но после появления premium full-mocks public-bucket
  `audio` начнёт конфликтовать с платным контентом (`src/lib/telegram/storage.ts`, BRIEF §428).

---

## Границы аудита (что НЕ проверено)

Аудит — read-only, статический. НЕ проверялось: live Supabase/Vercel runtime, реальные env,
prod-логи, bucket-политики, merchant/webhook-настройки; RLS-политики дословно; perf-замеры,
browser QA, Lighthouse, мобильные скриншоты, реальный Listening-flow; содержимое prod-БД (draft id,
реальные аудио/attempts/leaderboard). Эти оси — отдельный заход (динамический/security deep-dive).
