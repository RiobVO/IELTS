# AUDIT.md — аудит проекта (2026-06-24)

Внешний аудит (Codex) → **построчно верифицирован по коду** в Claude Code. Все ссылки
`file:line` проверены. Severity — **пересмотренные**; где расходится с исходной оценкой Codex,
помечено `(Codex: PN)`. Дополнительно проведён свежий аудит-с-нуля (7 осей, adversarial-verify).
Этот файл — **реестр находок, не план**: статус — в разделах ниже; осознанно отложенное вынесено
отдельно (принятые решения, НЕ баги). На 2026-06-24 открытых находок нет — все закрыты.

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

_Открытых находок нет._ Сверх Codex-аудита проведён **свежий аудит-с-нуля (2026-06-24, 7 осей:
data-exposure / tier-paywall / anti-cheat / auth-IDOR / recent-perf-changes / injection / schema-RLS,
adversarial-верификация каждого кандидата).** 6 из 7 осей — чисто (0 находок); ядро (утечка answer_key,
RLS, tier-гейт, целостность рейтинга, изоляция раннера, injection) подтверждено чистым в коде. Найдена
1 low-находка (malformed UUID → 500) — **закрыта тем же заходом** (см. «Закрыто»).

---

## Закрыто

### P3 — malformed UUID в owner-path → 500 вместо 404 (fresh audit 2026-06-24)
- **Severity:** P3 — low. Graceful-degradation gap + дешёвый authenticated 500-spam / лог-шум. НЕ
  security (не SQL-injection — интерполяция параметризована Drizzle; не утечка — answer_key EXISTS-gate
  и ownership-проверки целы; не escalation).
- **Было:** `id` (path) и `a` (`?a=`) шли прямо в Drizzle owner-path запросы по `uuid`-колонкам без
  проверки формата. Малформный UUID → Postgres `22P02 invalid input syntax for type uuid` → `global-error`
  рисует 500 вместо чистого `notFound()`. Поверхность: 3 owner-path screens (`exam/[id]/page.tsx`,
  `runner/route.ts`, `result/page.tsx`) + client-reachable `submitAttempt`. Legacy `/app/reading/[id]`
  иммунен (Supabase/PostgREST-клиент → `data:null` → `notFound`). Только новый Drizzle owner-path лишён
  graceful-деградации. Не регрессия perf-рефактора — pre-existing паттерн owner-path.
- **Закрыто:** 2026-06-24 — UUID-гард `isUuid()` (`src/lib/uuid.ts`, чистая функция + unit-тесты)
  перед запросом: `notFound()`/404/redirect до обращения к БД в `exam/[id]/page.tsx`, `runner/route.ts`,
  `result/page.tsx` (id + `?a=`), `submitAttempt`. Паритет с legacy-страницей.
- **Не трогали:** `saveProgress`/annotation-actions (уже в try/catch → тихий no-op, не 500);
  grading/answer_key/tier-гейты/EXISTS-gate.

### P2 — слишком быстрый submit не исключался из рейтинга (Codex: P1)
- **Severity:** P2 — integrity-фарм рейтинга (не деньги/безопасность).
- **Было:** `apply-post-submit.ts` рейтинговал первую попытку по `count==1` без взгляда на
  длительность — инстант-сабмит (start→мгновенная сдача) двигал Elo и difficulty теста.
- **Закрыто:** 2026-06-24 — floor-guard `isTooFastToRate(timeUsedSeconds, total)`
  (`src/lib/anti-cheat.ts`, чистая функция + unit-тесты): `rated = count==1 && !isTooFastToRate`.
  Порог `MIN_RATED_SECONDS_PER_QUESTION=3` сек/вопрос (в разы быстрее самого быстрого реального
  чтения → нет ложных срабатываний). `timeUsedSeconds` серверный (submit−start), проброшен в
  `applyPostSubmit`. Стрик/XP осознанно не трогаются (низкая ценность, не вектор лидерборда).
  Принятое следствие: too-fast первая попытка → тест остаётся unrated для юзера (первая-попытка-only).

### P2 — percentile считал все attempts и самого пользователя
- **Severity:** P2 — продуктовая метрика.
- **Было:** `result/page.tsx` считал percentile по ВСЕМ submitted-попыткам теста (включая ретейки и
  текущего юзера) — «of other students» был неточным.
- **Закрыто:** 2026-06-24 — percentile по ПЕРВОЙ submitted-попытке каждого ДРУГОГО юзера
  (`selectDistinctOn([userId]) … order by userId, submitted_at asc`, `ne(userId, self)`) — тот же
  first-attempt-per-user анти-фарм, что у лидерборда (опирается на `attempt_distinct_idx`). Порог
  показа `total >= 5` теперь = 5 других учеников.

### P2 — Telegram-аудио привязывалось к последнему Listening-тесту
- **Severity:** P2 — minor (admin-only поток).
- **Было:** `handleAudioUpload` брал глобально-последний listening (`order by created_at desc`) — mp3
  мог уехать на уже укомплектованный/чужой тест (два админа / повторная загрузка / задержка).
- **Закрыто:** 2026-06-24 — привязка к новейшему listening, КОТОРОМУ ЕЩЁ НУЖНО аудио (correlated
  `NOT EXISTS passage с audio_path`); если таких нет → честное сообщение вместо тихой перезаписи. Без
  миграции/состояния. Остаток (документирован): при двух ждущих черновиках берётся новейший — для
  точной привязки слать HTML и его mp3 до следующего HTML.

### P3 — SCHEMA_NOTES фиксировал «13 tables», реально 16
- **Severity:** P3 — schema governance.
- **Было:** `SCHEMA_NOTES.md` «Table count: 13», тогда как `src/db/schema.ts` — 16 `pgTable`
  (`verify.ts` уже `APP_TABLE_COUNT=16`).
- **Закрыто:** 2026-06-24 — счётчик обновлён до 16 с «post-Phase additions», каждая новая таблица
  привязана к миграции (`payment`→`0006`, `annotation`→`0013`, `leaderboard_snapshot`→`0014`); снят
  устаревший «13» и из RLS-секции.

### P2 — Listening-result ведёт drill-ссылками в Reading-каталог
- **Severity:** P2 — minor UX.
- **Было:** `app/app/reading/[id]/result/page.tsx` — `practiseHref` и все «Drill»/«Start»/«Back to
  catalog» CTA захардкожены на `/app/reading?q_type=...`. Result-роут общий для обеих секций, поэтому
  после Listening-теста дрилл-ссылки уходили в Reading-каталог (где listening-типов нет).
- **Закрыто:** 2026-06-24 — в `ci`-выборку дотянут `content_item.section`; выведен `catalogBase`
  (`/app/${section}`), на него переведены все catalog/drill-ссылки + `AppShell active` (теперь
  секционный; в навигации всё равно подсвечивает Practice). Доп. (по prod-смоку): «Try again» теперь
  повторяет маршрутизацию каталога — `has_runner ? /app/exam/${id} : /app/reading/${id}` (флаг
  `has_runner` тянется в `ci` без самого runner_html), а не хардкод `/app/reading/${id}`.
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
