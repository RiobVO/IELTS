# REDESIGN.md — bando visual redesign (6 экранов)

> Источник дизайна: `design-drop/redesign/` (Claude Design handoff, gitignored).
> Этот файл — трекер исполнения: что меняем на каждом экране, что СОХРАНЯЕМ, в каком
> порядке. Источник правды по виду — HTML-референсы в дропе; источник правды по
> логике — текущий код + [BACKLOG.md](./BACKLOG.md) / [WORKLOG.md](./WORKLOG.md).

## Контракт (как в WORKLOG §5)

> Юзеров пока нет → прод = по сути staging. Поэтому: пушим прямо в `main`, без фича-ветки;
> ручную проверку между шагами убираем, её заменяет **автогейт + тесты**; визуал смотрим
> **батчем на Vercel-проде** в конце (или когда удобно).

- **Один экран = один коммит+пуш в `main`.** Мини-план (файлы + что меняю + что сохраняю +
  acceptance) → «делай» → верстка → **автогейт зелёный** → коммит+пуш → `☐`→`✅`. Без ветки.
- **Автогейт перед каждым пушем (обязателен, автоматический):** `npx tsc --noEmit` +
  `npm run build` + `npm test` (vitest) — все зелёные. Красный → чиним, НЕ стакаем сломанное
  на сломанное. `build` НЕ гонять при живом `dev` (затрёт `.next`).
- **Тесты на логику-замок (обязательны там, где экран её трогает):** прогон существующих
  (grading/tiers/band/badges, 93 зелёных) после каждого экрана = логику не задели; +новый
  тест под затронутое. **Главный — на S5 results open-флаг в обе стороны** (open → free видит
  полный разбор; closed → гейт). Внешность тестами НЕ проверяем — это глаз на Vercel-проде.
- **Референсы — НЕ paste-in.** Верстаем в реальном коде на **существующих токенах**
  (`app/tokens/*.css`, сверены 1:1 с дропом) и компонентах (`src/components/core`,
  `src/components/exam`). Ссылаемся на `var(--token)`, НЕ на литералы oklch/hex/px.
- **НИЧЕГО НЕ ЛОМАТЬ.** grading / submit / RLS / tiers / рейтинг / Волна 1 — поведение
  идентично. Меняем ТОЛЬКО вид и раскладку; проводку к данным/server-actions сохраняем.
  Сверка «до/после» по score и гейтингу.
- Ноль новых runtime-зависимостей. Inline-стили + токены (без Tailwind/CSS-in-JS).
- UI-строки — английские (i18n отложен). Коммиты гранулярные, без AI-атрибуции.

## Политика монетизации (решено 2026-06-18)

**Results делаем бесплатным СЕЙЧАС, но гейтинг-код НЕ удаляем — держим открытым флагом.**
- Разбор (ответы/объяснения/evidence) — бесплатно для всех (рост аудитории).
- Seam `src/lib/tiers.ts` / `hasFullReview` остаётся; ворота в положении «open» (флаг),
  НЕ выпиливаем (вопреки фразе handoff «remove gating»). Включить платное позже = смена
  конфига, не рефактор.
- «Платно потом» вешаем на **новое** (Full-моки + история аналитики + Ultra/AI), а не на
  отобранный разбор → нет claw-back. При переключении — grandfather ранних юзеров.

## Глобально вне этого трека

- **Mobile/responsive** — отдельная L-волна ПОСЛЕ. Дроп desktop-only; если экран не
  адаптивен — это не блокер редизайна, фиксим в mobile-волну.
- **Тёмная тема** — токены dark-first, апп рендерит light через `data-theme="light"`.
  Тоггл не вводим в этом треке.
- **DS-линтер** (`_adherence.oxlintrc.json` из бывшей v2) — опциональный quality-gate
  на потом; новый dev-инструмент, отдельное решение.

## Карта файлов-источников (имена в дропе сдвинуты на один — маппинг по содержимому)

| Экран | Реальный файл в `design-drop/redesign/` |
|---|---|
| Exam-runner | `02-home-dashboard (1).html` |
| Dashboard (Option A, final) | `03-league (1).html` |
| League | `04-catalog (1).html` |
| Catalog | `05-results (1).html` |
| Results (no-premium → open-флаг) | `06-badges (1).html` |
| Badges | `HANDOFF (1).md` |
| Handoff-текст (спека) | `index (1).html` |

---

## Порядок исполнения

`Dashboard → League → Catalog → Badges → Results → Exam-runner`
(сначала без конфликтов и попроще; Results — с open-флагом; Exam — самый сложный, последним.)

---

## Экраны

### `✅` S1 · Dashboard → `app/app/page.tsx` (+`_AppShell`)
**✅ 2026-06-18:** Option A свёрстан — greeting, hero (Focus-card слабейшего типа + «This week»
с реальными week-dots/стрик/XP/глобальный rank), slim band→target шкала (3 честных состояния
W1-4), «Where you lose points» (worst-first из реального breakdown, −N pts/drill), recent с
относительным временем. Фейк-данные макета (`+0.5`/`Amethyst ▲4`/`3 tests`) заменены честными.
Кольцо/stat-строка удалены. +1 owner-запрос rank в общий `Promise.all`. tsc+build+93 тестов зелёные.
**Источник:** `03-league (1).html` (Home — Option A, final).
**Меняем:** убрать пустое band-кольцо; hero-ряд = Focus-card (слабейший тип + прогресс +
1 CTA) рядом с «This week» (стрик + week-dots + XP + лига); slim band→target шкала; полный
«Where you lose points» с drill-шевронами; recent tests.
**Сохраняем:** три честных состояния band (W1-4), weak-areas из реального breakdown,
identity/онбординг-гейт (W1-2), параллельные запросы (`_AppShell`).
**Закрывает/полирует:** W1-4. · **Acceptance:** band-состояния и данные те же, пустых
прочерков-заглушек нет; на проде вживую.

### `✅` S2 · League → `app/app/leaderboard/page.tsx`
**✅ 2026-06-18:** Option C (Regional leagues) — header «{scope} League», bando scope/period-табы
(globe/map-pin иконки, server-side URL-фильтр сохранён), 2-кол: ранг-доска (you-row glow, медали
топ-3, регион под именем) слева + Tiers-лестница (детерминированный rating→Bronze/Amethyst/Ruby/
Diamond, «You're here») и Your-standing (реальный #rank of N, дистанция до следующего) справа.
**Конфликт→честно:** промо/демоут-зоны + ▲/▼-дельты + таймер сброса выкинуты (нет недельного
сброса/истории рангов в бэке); «путь наверх» отдан tier-лестнице над реальным Elo. +icons globe/
map-pin. Elo/region self-join/readLeaderboard не тронуты. tsc+build+93 теста зелёные.
**Источник:** `04-catalog (1).html`.
**Меняем:** scope-табы Global→Uzbekistan→Tashkent→Yangiyo'l; tier-лестница
(Bronze→Amethyst→Diamond); your-standing карточка; зоны promotion/holding/demotion с ▲/▼;
строка «you» подсвечена (`--brand-subtle`+`--brand`+glow); читается и с малым числом игроков.
**Сохраняем:** Elo/рейтинг-логику, region self-join, identity (display_name/region из
онбординга W1-2), rated-only-first-attempt.
**Закрывает:** W1-7 (лидерборд про людей) + §4.6 регионы. · **Acceptance:** реальные
ранги/регионы, «you» верно подсвечен; на проде.

### `✅` S3 · Catalog → `app/app/reading/page.tsx` (+`_CatalogView`)
**✅ 2026-06-18:** Option C (Weak-spot first) в общем `_CatalogView` (Reading+Listening сразу) —
«Recommended for you» баннер (тест под реальный слабейший тип из per_type_breakdown; показывается
только без фильтра и при наличии данных+матча, иначе скрыт — без фейка), фильтр сохранён, compact
2-up грид (бейдж + Q-count + duration + 3 тип-тега «+N» + Start/Premium-замок, равная высота).
Q-count добавлен в кэш-функцию `getPublishedTests` (grouped count, тот же тег). tier-замок/фильтр-
логика/`unstable_cache` не тронуты. Дедуп seed-карточек — это данные (prod БД), не код-скоуп.
tsc+build+93 теста зелёные.
**Источник:** `05-results (1).html`.
**Меняем:** баннер «Recommended for you» (тест под слабейший тип); СОХРАНИТЬ фильтр
(category + q_type чипы); compact 2-up грид, каждая карточка = category-бейдж + Q-count +
duration + type-теги + Start (или Premium-замок); фикс раздутых/пустых seed-карточек.
**Сохраняем:** фильтр-логику, `unstable_cache`/тег `content_item`, tier-замок на premium-тесты,
дедуп демо-контента (отдельно, данные).
**Закрывает:** W2-4. · **Acceptance:** фильтры/счётчики работают, карточки информативны; на проде.

### `✅` S4 · Badges → `app/app/badges/page.tsx`
**✅ 2026-06-18:** Option B (Next-up spotlight) — тёмный hero (ближайший к разблокировке бейдж:
большой ring + реальный прогресс), грид split Earned/Locked, уникальная Lucide-иконка на бейдж
(`code→icon` маппинг — в БД `icon` это эмодзи, поэтому иконок раньше не было), earned = glow-медальон
+ check, locked = progress-ring + «how close». Прогресс — из движка: экспортировал `computeStats`/
`Criteria`/`UserStats` + добавил чистую `badgeProgress` (критерии НЕ дублирую). +8 иконок (footprints/
dumbbell/route/shield/sparkles/star/award/pencil-check). **Конфликт→честно:** бейджи авто-выдаются
(ручного claim нет) → зелёной кнопки-обманки «Claim» нет, ≥85% = зелёный ring + «Almost there», CTA
hero «Keep going» → практика. tsc+build+93 теста зелёные.
**Источник:** `HANDOFF (1).md` (Next-up spotlight).
**Меняем:** тёмный hero — бейдж, ближайший к разблокировке (ring + прогресс); грид split
Earned/Locked; уникальная Lucide-иконка на бейдж; earned = glow-медальон + check; locked =
progress-ring + «how close», ≥85% → зелёный Claim.
**Сохраняем:** критерии бейджей (`src/lib/progress/badges.ts`), реальный earned/прогресс,
EN-строки (миграция `0011`), unlock-анимацию с `prefers-reduced-motion`.
**Закрывает:** W2-5 (частично — визуал «учеба»). · **Acceptance:** earned/locked и прогресс
реальные; на проде.

### `☐` S5 · Results → `app/app/reading/[id]/result/page.tsx`
**Источник:** `06-badges (1).html` (clean analytics, no-premium).
**Меняем:** donut (% correct) + band; key-metrics (время, avg/вопрос, percentile vs others,
Δ vs прошлый); accuracy-by-type бар-чарт + per-type Practise-ссылка; одно-строчная
рекомендация; полный answer-key (твой ответ / верный / объяснение / цитата-evidence).
**Сохраняем (КРИТИЧНО):** серверный грейдинг и `raw_score` нетронуты; **гейтинг-код НЕ
удаляем** — `hasFullReview`/tiers остаются, ставим открытый флаг (см. «Политика монетизации»);
answer_key только server-side (RLS), не утекает в free-HTML до сабвита.
**Связано:** W1-1/W1-3 (open-флаг = временный откат пейволла). · **Acceptance:** score
идентичен «до/после»; разбор виден всем; флаг закрывается одной правкой; на проде.

### `☐` S6 · Exam-runner → `app/app/reading/[id]` (`ExamRunner`)
**Источник:** `02-home-dashboard (1).html` (Editorial paper).
**Меняем (ТОЛЬКО левая панель-пассаж):** masthead (mono overline · serif title · word-count
& read-time); drop-cap; буквы абзацев в левом поле; reading-progress бар сверху панели;
annotation-капсула (highlight / note / A−A+ / theme) по центру внизу. Правая панель
(вопросы + навигатор) — НЕ трогаем.
**Сохраняем:** таймер/навигатор/autosave/submit/идемпотентность, `<audio>`-владение раннером,
`memo` вопросов, mcq_multi/completion-инпуты, серверное время.
**Закрывает:** W2-1 (highlight/notes) + W2-7 (вёрстка). · **Acceptance:** ввод/автосейв/
сабмит идентичны; подсветка/заметки персистят; на проде.

---

## Сводка

| # | Экран | Файл-источник | Закрывает | Статус |
|---|---|---|---|---|
| S1 | Dashboard | `03-league (1).html` | W1-4 | ✅ |
| S2 | League | `04-catalog (1).html` | W1-7 + §4.6 | ✅ |
| S3 | Catalog | `05-results (1).html` | W2-4 | ✅ |
| S4 | Badges | `HANDOFF (1).md` | W2-5 | ✅ |
| S5 | Results | `06-badges (1).html` | W1-1/W1-3 (open-флаг) | ☐ |
| S6 | Exam-runner | `02-home-dashboard (1).html` | W2-1 + W2-7 | ☐ |
