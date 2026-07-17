# IELTS Platform — Engineering & Design Brief

> **Статус:** v0.2 (ядро §§1–9 реализовано; актуальный фронт работ — §12)
> **Один абзац:** Веб-платформа для подготовки к IELTS с ядром на Reading и
> Listening (Writing/Speaking — AI-оценка реализована, включается env-флагом). Контент загружается админом как
> HTML и строго категоризируется по типам вопросов. Цель — не «функциональный
> сайт», а **продукт №1 в отрасли** по визуальному качеству, скорости и точности
> симуляции экзамена.

---

## 0. North Star — что значит «№1»

Три измеримых обещания. Если фича не служит одному из них — она во вторую фазу.

1. **Самая правдоподобная симуляция экзамена.** Интерфейс прохождения теста
   ощущается как реальный computer-delivered IELTS: таймер, навигация по вопросам,
   highlight/notes на тексте, review-режим. Студент тренируется в тех же условиях.
2. **Самая глубокая аналитика по типам вопросов.** Студент видит не «6.5 балл», а
   «ты теряешь баллы на *Matching Headings* и *True/False/Not Given*» — и может
   отфильтровать тренировку ровно под слабое место. Это и есть killer-feature
   категоризации.
3. **Визуально — топ-1%.** Не template, не «ноунейм-дашборд». Узнаваемый
   фирменный стиль, премиальная типографика, осмысленная анимация. Уровень
   Linear / Duolingo / Arc, а не Bootstrap-админка.

**Anti-goals (чего НЕ делаем):** generic Material/Bootstrap-вид; стоковые
иллюстрации; перегруз градиентами ради «вау»; геймификация, мешающая учёбе.

---

## 1. Design North Star — визуальный уровень

### 1.1 Принцип
Дизайн ведёт продукт, а не украшает его в конце. Каждый экран проходит планку:
*«senior-дизайнер из топовой студии за это бы не стыдился?»* Если нет — переделать.

### 1.2 Рекомендованное направление (lock 1 из 3)

**A. «Focused Calm» (рекомендую).**
Спокойный, премиальный, «учебный люкс». Много воздуха, крупная редакторская
типографика для текстов passage, приглушённая база + один насыщенный
brand-акцент. Ассоциация: премиальный e-reader × Linear. Почему: Reading/
Listening — это долгая концентрация; визуальный шум напрямую вредит результату.

**B. «Bold Academic».**
Контрастный, уверенный, с характером: тёмная тема по умолчанию, неоновый акцент,
выразительные числа в аналитике. Ассоциация: Vercel / Arc. Риск: тяжелее для
длинного чтения.

**C. «Playful Mastery».**
Геймифицированный, дружелюбный, с маскотом и живыми micro-illustrations.
Ассоциация: Duolingo. Риск: может читаться «несерьёзно» для платного IELTS.

> **РЕШЕНО:** курс — «взрослый WOW» (премиум, **dark-first**, тонкая геймификация:
> энергия B/C без детскости). Конкретные tokens/макеты — в Claude Design (§7.1).

### 1.3 Обязательные элементы визуального качества
- **Design tokens** с самого начала: цвет, типографика, spacing-шкала, радиусы,
  тени, motion-кривые. Никаких hardcoded значений в компонентах.
- **Типографика как фича.** Отдельный reading-typeface для passage (комфортный
  measure 60–75 символов, межстрочный ≥1.6). UI-шрифт отдельно.
- **Motion с намерением.** Переходы между вопросами, появление результатов,
  разблокировка бейджа — анимированы по единым easing-кривым. Не дёргано,
  не ради эффекта. Уважать `prefers-reduced-motion`.
- **Dark mode** — first-class, не «инверсия в конце».
- **Пустые состояния и загрузка** спроектированы (skeletons, не спиннеры).
- **Микро-детали:** focus-кольца, hover-состояния, тактильная обратная связь.

---

## 2. Experience Principles
1. **Mobile-first.** Аудитория (UZ и шире) преимущественно с телефонов. Сначала
   дизайним узкий экран, потом расширяем.
2. **Скорость = доверие.** Мгновенная навигация, оптимистичный UI, без «белого
   экрана».
3. **Прогресс всегда виден.** Где я, сколько прошёл, что дальше.
4. **Учёба важнее очков.** Геймификация усиливает мотивацию, но не отвлекает от
   теста.

---

## 3. Information Architecture (site map)

```
/                       Лендинг (позиционирование, тарифы, CTA регистрации)
/auth                   Email / Apple / Facebook
/app                    (auth) Dashboard — прогресс, стрики, быстрый старт
  /reading              Каталог Reading с фильтрами
    ?category=passage_2&q_type=matching_headings
    /reading/:id        Прохождение теста (exam-режим)
    /reading/:id/result Разбор: ответы, объяснения, разбивка по типам
  /listening            То же для Listening (Part 1–4, Full)
  /writing              Темы (загружены админом) — AI-оценка (Phase 3, env-gated)
  /speaking             Темы — AI-оценка (Phase 3, env-gated)
  /leaderboard          Лидерборд с фильтром по территории
  /badges               Достижения
  /profile              Аккаунт, тариф, рефералы
  /invite               Пригласи друга
/admin                  (role=admin) Загрузка HTML + теггинг, темы, модерация
```

---

## 4. Feature Spec (Phase 1)

### 4.1 Категоризация контента — ядро
- Каждый content-item: `section`, `category`, `question_types[]`, `tier_required`.
- **Reading categories:** Passage 1, Passage 2, Passage 3, Full Reading.
- **Listening categories:** Part 1, Part 2, Part 3, Part 4, Full Listening.
- **Канонический справочник типов вопросов** (фиксированный enum, нельзя
  freeform):
  - *Reading:* Multiple choice; True/False/Not Given; Yes/No/Not Given;
    Matching headings; Matching information; Matching features; Matching sentence
    endings; Sentence completion; Summary/Note/Table/Flow-chart completion;
    Diagram label completion; Short-answer.
  - *Listening:* Multiple choice; Matching; Plan/Map/Diagram labelling;
    Form/Note/Table/Flow-chart completion; Sentence completion; Short-answer.
- **Фильтрация** в панелях Reading/Listening: по категории И/ИЛИ по типам вопросов
  (мультивыбор). Это первичный способ навигации студента.

### 4.2 Формат контента и проверка — ЗАФИКСИРОВАНО (решение open-q #4)

**Реальный источник (проверено на 8 файлах):** каждый тест — самодостаточный
HTML по ЕДИНОМУ шаблону (классы `tfng-`/`mcq-`/`inspera-`, `STORAGE_KEY`),
с готовыми JS-объектами в конце файла:
`correctAnswers`, `acceptableAnswers`, `mcqGroups`, `questionTypes`,
`explanations`, `evidence`, и таблицей band (`getBandFor40`).

**Принцип: импортируем эти файлы в структурную модель; ключ — на сервере, в
клиент НЕ уходит; проверка и разбор — на сервере; рендер — своими компонентами**
(а не показ чужого HTML — иначе теряется консистентный UI и утекают ответы).

- **Импорт-парсер — детерминированный, без LLM.** Читает JS-объекты + разметку,
  достаёт: passage, вопросы, ключ, типы, объяснения, evidence, band-таблицу.
- **3 режима хранения ответа** (движок проверки роутит по ним):
  - `mcq_set` — из `mcqGroups` (набор букв, напр. `['A','E']`);
  - `text_accept` — из `acceptableAnswers` (массив вариантов, case-insensitive,
    напр. `['prisons','prison']`); нормализация = trim + upper + схлоп пробелов;
  - `exact` — из `correctAnswers` (одно значение: TFNG/YNNG/matching-буква).
- **Канонический enum + маппинг ярлыков** (ярлыки в файлах НЕсогласованы —
  `YES / NO / NOT GIVEN` vs `Yes/No/Not Given` и т.п.). Нормализация lookup'ом:
  `tfng, ynng, mcq_single, mcq_multi, matching_headings, matching_info,
  matching_features, matching_sentence_endings, sentence_completion,
  summary_completion, note_completion, flowchart_completion,
  table_completion, diagram_label` (+ Listening: `map_labelling`, `form_completion`).
- **Безопасность:** ключ / `explanations` / `evidence` НЕ сериализуются в клиент
  до сабмита. Сабмит → сервер сверяет → `score` + band + `per_type_breakdown` +
  (после сдачи) разбор. Исходные ответы вырезаются из рендера.

### 4.2.1 Загрузка контента (Admin)
- Админ грузит готовый HTML → парсер авто-извлекает ВСЁ (контент, ключ, типы,
  разборы). **Ручного ввода вопросов нет.**
- **`question_types[]` авто-извлекается** из `questionTypes` (через канон-маппинг)
  → один источник правды, заполняет фильтр каталога.
- Экран ревью: подсветка низкоуверенных мест; **админ обязан подтвердить ключ**
  (неверный ключ = неправильная оценка у всех).
- Draft / Published статусы.
- **Open:** Listening-файлов пока нет; формат аудио + map/form-completion
  добиваем на первом реальном файле (ожидается тот же шаблон).

### 4.3 Прохождение теста (exam-режим)
- Таймер (по правилам IELTS: Reading 60 мин, Listening ~30+10 мин).
- Навигатор по вопросам, отметка «на review», highlight текста, заметки.
- Listening: аудиоплеер (воспроизведение по правилам — обычно один проход).
- Автосохранение прогресса; устойчивость к потере соединения.
- Сабмит → авто-проверка объективных типов → score + разбор.

### 4.4 Результаты и аналитика
- Score (приближение band-score) + правильные/неправильные.
- **Разбивка по типам вопросов** — где теряются баллы.
- История: daily / weekly / monthly; кол-во завершённых тестов; тренды.
- **Trajectory/Forecast (Progress → Overview; зафиксировано 2026-07-15):** график и прогноз
  строятся только по **mock**-сдачам полных тестов с band > 0 (band 0 = «не пытался»;
  practice — тренировка, не замер — на линию и в прогноз не попадает). Линия — сквозная
  через каждый мок («научный» вариант, выбор владельца); ось Y обнимает данные; цель вне
  окна — бейдж «Target N ↑», не линия. Формулы прогноза (OLS + капы прироста) и X-домен
  заморожены владельцем.

### 4.5 Аккаунты и роли
- Регистрация: Email, Apple OAuth, Facebook OAuth.
- Роли: `student`, `admin`.

### 4.6 Лидерборд + анти-чит
- Партиционирование по **территории** иерархически: страна → регион → район
  (Tashkent → Yangiyo'l tumani). Поле региона — иерархическое, чтобы масштабироваться.
- Периоды: weekly / monthly / all-time.
- Рейтинг — Elo-style (старт 1000), хранить `peak_rating`.

**Анти-чит (критично — у конкурента тут дыра, у нас не должно быть):**
- Проверка и счёт — **только на сервере**; клиент НИКОГДА не присылает готовый
  `score`/`band` (у конкурента присылает → накрутка одной строкой в консоли).
- **Рейтингуется только ПЕРВАЯ попытка теста**; retake = practice-only, в рейтинг
  не идёт (хорошая идея, подсмотрено у конкурента — оставляем).
- Время — серверное (`started_at`/`submitted_at`), невозможно быстрые прогоны → флаг.
- Rate-limit на submit-эндпоинт; идемпотентность по (user, test).
- `hidden_from_leaderboard` для подозрительных/тестовых аккаунтов.

### 4.7 Бейджи (геймификация)
- Игровые ачивки (стрики, объём, точность по типу вопроса, первые места).
- Анимация разблокировки. Витрина в `/badges`.

### 4.8 Тарифы — ЗАФИКСИРОВАНО (делегировано исполнителю)

Гейт по `tier` пользователя + `tier_required` контента.

| Фича | Basic (free) | Premium | Ultra |
|---|---|---|---|
| Reading/Listening (passage/part и full-тесты) | ✅ 2 practice/день + 2 mock/нед (суммарно R+L, не по секциям; 2026-07-17: контент полностью бесплатен для всех тиров решением владельца — старый full-тест-замок и 25/день mock-кап сняты; trial-механика для R/L вестигиальна, код не удалён) | ✅ безлимит | ✅ безлимит |
| Разбор + evidence после сдачи | базовый | полный | полный |
| Аналитика по типам + история (d/w/m) | 7 дней | полная | полная |
| Лидерборд (рейтинг, регионы) | просмотр | участие | участие |
| Бейджи / стрики | ✅ | ✅ | ✅ |
| AI-оценка Writing (Phase 3 — env-gated) | — | ✅ | ✅ |
| AI-оценка Speaking (Phase 3 — env-gated) | — | — | ✅ |

- **Оплата:** Payme + Click + Uzum (локальные UZ).
- Числа лимитов Basic зафиксированы 2026-07-17 (см. таблицу выше) — плейсхолдер `N` снят.

### 4.9 Рефералы
- Invite-friends: персональная ссылка, награда за приглашение (бейдж/доступ/срок).

### 4.10 Writing / Speaking (Phase 3 — active, env-gated)
- Админ грузит темы; UI, data-model и AI-оценка реализованы (Gemini Flash, async:
  store → internal secret-gated API-route → poll). Фича видна и работает ТОЛЬКО при
  полном конфиге: `GEMINI_API_KEY` + `WRITING_EVAL_MODEL`/`SPEAKING_EVAL_MODEL` +
  internal-secret + публичный origin (`writingFeatureEnabled`/`speakingFeatureEnabled`);
  иначе экраны делают `redirect("/app/practice")`. Тиры: Writing = Premium,
  Speaking = Ultra (суб-tier получает 1 пробную оценку).
- **Acceptance.** *Security:* submit-гейт = задача `published` (для всех) + `tier_required`
  только для at-tier (суб-tier — free-preview lane) + UUID-screening (owner-path); raw-вывод (`*_feedback_debug`)
  hard-locked (RLS + revoke, проверяет `npm run verify`); фича доступна только при
  полном конфиге (model+key+secret+origin). *Payment:* грант тира — только через
  webhook (§4.8); дневной кап оценок ограничивает расход. *AI:* evaluator только через
  internal secret-gated route; ядро Reading/Listening остаётся LLM-free (§4.2).

### 4.11 Vocabulary (на проде; внесено в бриф постфактум)
Словарный модуль вне исходного скоупа Phase 1–3, уже реализован: деки/карточки
(`vocab_deck`/`vocab_card`, published-гейт как у `content_item`), SM-2 spaced
repetition (`vocab_progress`), «Saved words» — свои слова из разбора со своим
SM-2-стейтом (`saved_word`, миграция `0041`). LLM-free, без внешних словарей.
Детали и RLS-постура — SCHEMA_NOTES.md; практика-трек — PRACTICE_PLAN.md.

---

## 5. Data Model — v1 (Postgres)

> Подход: контент и ответы разнесены (security); `answer_key` — отдельная
> таблица, никогда не join'ится в клиентский payload. `per_type_breakdown` и
> агрегаты дашборда/лидерборда предрасчитываются. Enum-поля — Postgres enum.

**region** — иерархия территорий (UZ-фокус: страна → вилоят(14) → туман)
- `id`, `parent_id` (FK self, null для страны), `name`, `level` (country|region|district)
- сидим справочником Узбекистана.

**user** (набор полей сверен с прод-моделью конкурента)
- `id`, `email` (unique), `auth_provider` (email|apple|facebook), `display_name`,
  `avatar_url`, `region_id` (FK), `role` (student|admin), `tier` (basic|premium|ultra),
  `premium_until` (timestamptz null), `rating` (int, Elo, старт 1000), `peak_rating`,
  `rated_count`, `xp`, `current_streak`, `longest_streak`, `last_activity_date`,
  `target_band` (numeric null), `timezone`, `referral_code` (unique), `referred_by` (FK null),
  `hidden_from_leaderboard` (bool), `created_at`
- индексы: `region_id`, `rating`, `referral_code`.

**content_item** — тест-контейнер (одиночный passage/part ИЛИ Full из N секций)
- `id`, `section` (reading|listening), `category` (passage_1..passage_3 | full_reading |
  part_1..part_4 | full_listening), `title`, `source_file_path` (оригинал в storage),
  `duration_seconds`, `tier_required` (basic|premium|ultra),
  `band_type` (reading_academic|reading_general|listening),
  `question_types` (text[] канон-enum — фильтр каталога), `band_scale` (jsonb raw→band),
  `status` (draft|published), `version` (int — для re-grade), `created_by`, `created_at`
- индексы: `(section, category)`, GIN на `question_types` (быстрый фильтр — §6.1).

**passage** — секция теста (passage у Reading / part у Listening). Full = N секций.
- `id`, `content_item_id` (FK), `order`, `title`, `body_html` (sanitized, рендер),
  `audio_path` (Listening — у каждой части своё аудио)
- одиночный тест = 1 строка; Full Reading = 3; Full Listening = 4.

**question**
- `id`, `content_item_id` (FK), `passage_id` (FK — к какой секции), `number` (1..40),
  `qtype` (канон-enum), `prompt_html`,
  `options` (jsonb — буквы+текст для MCQ/matching, null для completion),
  `group_key` (для mcq_multi, напр. '8-12'), `evidence_ref` (id абзаца), `order`
- индексы: `content_item_id`, `passage_id`.

**answer_key** — ⚠️ серверная, в клиент не уходит до сдачи
- `id`, `question_id` (FK unique), `mode` (mcq_set|text_accept|exact),
  `accept` (jsonb — массив допустимых значений/букв),
  `explanation` (text), `evidence` (jsonb {para, snippet})
- читается ТОЛЬКО grading-сервисом и пост-сабмит разбором.

**attempt**
- `id`, `user_id` (FK), `content_item_id` (FK), `mode` (practice|mock),
  `status` (in_progress|submitted), `answers` (jsonb {number: value} — для resume/review),
  `started_at`, `submitted_at`, `time_used_seconds`, `raw_score`, `band_score`,
  `per_type_breakdown` (jsonb {qtype: {correct, total}})
- индексы: `(user_id, submitted_at)` — история дашборда; `content_item_id`.

**badge / user_badge**
- badge: `id`, `code`, `name`, `description`, `icon`, `criteria` (jsonb)
- user_badge: `user_id`, `badge_id`, `earned_at` (PK составной).

**referral**
- `id`, `inviter_id` (FK), `invitee_id` (FK null до регистрации), `code` (unique),
  `status` (sent|registered|rewarded), `reward`, `created_at`.

**leaderboard_entry** — предрасчёт (материализованное / периодический пересчёт)
- `user_id`, `period` (weekly|monthly|all_time), `scope` (global | region_id),
  `score`/`rating`, `rank` — обновляется джобой, не считается on-the-fly.

**topic** (Phase 3 — наследие-заглушка, не используется фичей)
- `id`, `skill` (writing|speaking), `prompt`, `tier_required`. Реальные таблицы Phase 3 —
  `writing_task` / `speaking_task` (+ submission/feedback/feedback_debug), миграции 0023+.

### 5.1 Поток проверки (grading)
1. Сабмит: клиент → `{number: value}` в `attempt.answers`.
2. Сервис тянет `answer_key` по вопросам теста, сверяет по `mode`:
   `mcq_set` (set равенство) / `text_accept` (нормализация + вхождение в `accept`) /
   `exact` (нормализованное равенство).
3. Пишет `raw_score`, `band_score` (по `band_scale`), `per_type_breakdown`.
4. Пост-сабмит отдаёт разбор (`explanation`+`evidence`) — не раньше.

---

## 6. System Architecture

> **Приоритет №1 (решение пользователя):** stable + fast + «ахуенно». Любой
> технический выбор ниже подчиняется этим трём в этом порядке.

- **Стек — ЗАФИКСИРОВАН:** Next.js (App Router) + TypeScript; Postgres;
  объектное хранилище для HTML/аудио (Supabase Storage / S3-совместимое);
  Supabase для auth (Email + Apple + Facebook из коробки); деплой Vercel + CDN.
  Запас по нагрузке — десятки тысяч пользователей (текущие 500 из Telegram —
  незаметная нагрузка).

### 6.1 Как гарантируем «стабильно + быстро» (рычаги, не лозунг)
- **Медиа через CDN, не через сервер.** Аудио Listening и HTML отдаёт CDN —
  это главное узкое место по трафику, не БД. Без этого «500 разом» бьёт по
  bandwidth.
- **Предрасчёт тяжёлого.** Лидерборд и daily/weekly/monthly агрегаты —
  материализованные представления / периодический пересчёт, а не on-the-fly.
- **Edge-кэш статики + ISR** для каталога и лендинга → мгновенная отдача.
- **Оптимистичный UI + автосохранение** на прохождении теста → нет «белого
  экрана», попытка переживает потерю связи.
- **Индексы под фильтрацию** по (section, category, question_types[]) — это
  самый частый запрос, он обязан быть быстрым.
- **Quality-bar из §8** (LCP <2s, Lighthouse ≥95) — критерий приёмки на каждом
  релизе, а не «вроде летает».
- **Безопасность (Supabase-специфика — критично):** клиент ходит в БД с
  anon-ключом, поэтому `answer_key` ОБЯЗАН быть закрыт **RLS-политикой** (клиент
  физически не может его прочитать). Grading выполняется только server-side со
  **service-role** (Route Handler / Edge Function), не на клиенте. Секреты в env;
  role-based доступ к `/admin`; rate-limit на мутации.

---

## 7. Frontend Architecture & Design System

- **Design tokens** (единый источник): colors, typography scale, spacing,
  radii, shadows, motion. Темы light/dark из токенов.
- **Компонентная библиотека:** Button, Input, Select, Tabs, Card,
  QuestionFilter, ExamTimer, QuestionNavigator, ResultBreakdown, BadgeUnlock,
  LeaderboardRow, ProgressChart. Все состояния (hover/focus/disabled/loading/empty).
- **Доступность:** WCAG 2.1 AA — контраст, клавиатурная навигация, фокус,
  `prefers-reduced-motion`, screen-reader для exam-интерфейса.
- **Производительность фронта:** code-splitting по маршрутам, lazy-загрузка
  тяжёлого (аудио, чарты), skeletons вместо спиннеров.

### 7.1 Процесс дизайна (протокол) — ЗАФИКСИРОВАНО
Дизайн делаем в **Claude Design**, не в этом чате. Когда стартует фаза дизайна,
ассистент обязан: (1) явно объявить «переходим к дизайну»; (2) напомнить открыть
Claude Design; (3) выдать готовый ПРОМТ со всеми решениями брифа (бренд,
«взрослый WOW», dark-first, design-tokens, ключевые экраны, фильтр по типам,
анти-AI-slop). Пользователь вставляет промт в Claude Design.

---

## 8. Quality Bar — критерии приёмки «№1»

Числа — стартовые цели, уточним.

- **Performance:** LCP < 2.0s (4G), interaction latency < 100ms, CLS < 0.1.
- **Lighthouse:** ≥ 95 Performance / Accessibility / Best Practices.
- **Reliability:** прерванная попытка восстанавливается без потери ответов.
- **Design QA:** каждый экран проходит дизайн-критику (иерархия, типографика,
  spacing, состояния) перед мержем.
- **Cross-device:** безупречно на мобильном (приоритет), планшете, десктопе.

---

## 9. Roadmap (фазы)

- **Phase 1 — MVP ядра:** auth, admin-загрузка+теггинг, каталог с фильтрами,
  exam-режим Reading + Listening, авто-проверка, результаты+разбивка по типам,
  базовый дашборд. → *Done = студент проходит реальный тест и видит разбор по типам.*
- **Phase 2 — Engagement:** лидерборд по территориям, бейджи, рефералы, тарифы+оплата.
- **Phase 3 — AI (active, env-gated):** автооценка Writing и Speaking по загруженным
  темам реализована (Gemini Flash, async store→route→poll). Включается env-флагом
  (model+key+internal-secret+origin); при неполном конфиге скрыта. Тиры: Writing =
  Premium, Speaking = Ultra. Ядро Reading/Listening остаётся LLM-free (§4.2).

---

## 10. Open Questions / Decisions Log

**Закрыто:**
- ~~Стек~~ → Next.js + Postgres + Supabase + Vercel/CDN (§6).
- ~~Формат контента~~ → импорт из готовых HTML, ключ+грейдинг на сервере (§4.2).
- ~~Языки~~ → EN на старте → RU + UZ далее.
- ~~Тарифы~~ → Basic/Premium/Ultra (§4.8); оплата Payme/Click/Uzum.
- ~~Band-score~~ → официальная таблица raw→band из файлов (`getBandFor40`).
- ~~Территории лидерборда~~ → иерархия Узбекистана (страна→вилоят→туман).
- ~~LLM~~ → в ядре НЕ используется; только Phase 3 (Writing/Speaking AI).
- ~~Phase 3 (AI)~~ → **реализована, active / env-gated**: автооценка Writing/Speaking
  (Gemini Flash, async) включается env-флагом (model+key+secret+origin). Writing =
  Premium, Speaking = Ultra. Ядро остаётся LLM-free (§4.2). Заглушка `topic` + enum
  остаются (не используются — фича на `writing_task`/`speaking_task`).
- ~~Канон-enum типов~~ → зафиксирован (§4.2), маппинг ярлыков.
- ~~Все файлы один шаблон~~ → подтверждено на 8 файлах → парсер без LLM.
- ~~Аудит брифа (15 находок)~~ → решения в §11; контент-права на стороне клиента.

**Открыто:** актуальный консолидированный список — **§12** (долги, новые фичи,
рекомендованный порядок). Исторические пункты 1–4 ниже поглощены §12:
1. **Дизайн-исполнение:** курс — «взрослый WOW» (премиум, dark-first, тонкая
   геймификация). Конкретные tokens/макеты — фаза дизайна (Claude Design, §7.1).
2. **Listening-формат:** нет ни одного файла. Аудио + map/form-completion
   добиваем на первом реальном файле (ожидается тот же шаблон).
3. **Лимиты Basic** (N тестов/день) — подобрать при запуске → §12.1 п.4.
4. **Apple/Facebook OAuth:** нужны dev-аккаунты/ключи (Apple Developer — платный) → §12.1 п.3.

---

## 11. Audit Resolutions (decided)

- **Контент-права:** HTML принадлежат КЛИЕНТУ; мы — разработчик. Лицензия на
  материалы — зона ответственности клиента (зафиксировать в договоре/README).
- **Band-scale:** отдельные таблицы raw→band для Reading Academic, Reading General,
  Listening. **Band показываем ТОЛЬКО для Full-тестов (40 вопросов);** одиночный
  passage/part → процент правильных, без band (band на 13Q официально не определён).
- **Re-grade:** контент версионируется (`content_item.version`); правка `answer_key`
  → фоновый пересчёт затронутых `attempt` + пометка «балл уточнён».
- **i18n:** контент теста ВСЕГДА английский; локализуется только UI-chrome (меню,
  кнопки, дашборд) через next-intl + locale-routing. EN → RU + UZ.
- **Telemetry:** error-monitoring (Sentry) + product-аналитика (события: старт/сдача
  теста, фильтр, апгрейд) — чтобы знать, что улучшать.
- **Notifications + weekly digest (лучше конкурента):** напоминания о стрике,
  недельный дайджест (тесты, средний band, Δ рейтинга); таблица `notification`.
- **Подписки lifecycle:** webhook Payme/Click/Uzum → продление `premium_until`;
  истечение → авто-даунгрейд в Basic; cron-проверка просрочки.
- **Анти-бот / абуз:** email-верификация + captcha/Turnstile на signup; реферал-награда
  только после реальной активности приглашённого (≥1 сданный тест); блок self-referral.
- **ORM/миграции:** Drizzle (type-safe, лёгкий, дружит с Supabase/Postgres), up/down.
- **Low:** поиск по названию в каталоге; стрики/агрегаты в `user.timezone`;
  premium-аудио через подписанные URL (anti-leech); account deletion + экспорт данных.

---

## 12. Roadmap Next (снимок 2026-07-08) — актуальный фронт работ

> Ядро §§1–9 реализовано (~90%). Здесь — открытые долги брифа, новые фичи вне
> исходного скоупа и рекомендованный порядок. Открытые пункты Волны 2 и гипотезы
> H2–H5 живут в BACKLOG.md — здесь только ссылки, без дублей.

### 12.1 Долги брифа (обещано — на проде нет)

| # | Что | Где в брифе | Severity | Блокирует |
|---|---|---|---|---|
| 1 | Платёжные подписи Payme/Click/Uzum — webhook стоит на generic HMAC-заглушке (fail-closed), деньги не принимаются. 2026-07-08: прод-тупик UI закрыт гейтом `paymentsLive(provider)` — без ключа CTA = waitlist «Notify me» (`payment_waitlist`-события), pending-строки не создаются, sandbox-чекаут недостижим; копирайт /pricing приведён к правде (без 1:1 call / money-back / prorated). Осталось ровно: ключи → провайдер-специфичные адаптеры вебхука + redirect-back/поллинг чекаута (L) | §4.8 | **blocker** (revenue) | владелец: merchant-ключи |
| 2 | ✅ Email-блок — закрыт 2026-07-08: Brevo-аккаунт активирован (support-тикет #5451764), ключ ротирован (Vercel Production + `.env.local`), 2 pre-activation тестовые `weekly_digest`-строки удалены, живой прогон digest (3/3 доставлено в inbox, подтверждено визуально). Smoke реальной регистрацией на проде прошёл end-to-end (письмо → клик → сессия → `/app/onboarding`). Побочно найден и починен баг: дефолтный Supabase Confirm-signup шаблон (голый текст + sender name `IELTS Weekly` вместо бренда) ловил `otp_expired` и падал в спам — заменён на брендированный HTML + sender name `bando` (Supabase Dashboard → Auth → Email Templates/SMTP Settings, вне репо). Оговорка: ретест шёл на аккаунте, где владелец уже пометил первое письмо «не спам» — чистая репутация домена для незнакомых получателей подтверждена частично, дальше только органика + мониторинг bounce/complaint в Brevo dashboard | §11 | done | нет — мониторить репутацию по мере роста живых регистраций |
| 3 | Apple/Facebook OAuth (сейчас только email) | §4.5 | important | владелец: dev-аккаунты/ключи |
| 4 | ✅ Лимиты Basic — 2026-07-17 (owner decision, отменяет старую версию §4.8 для R/L): весь Reading/Listening контент бесплатен для всех тиров, старый флэт-кап `BASIC_DAILY_LIMIT=25` на submitted-мокax заменён на `BASIC_PRACTICE_DAILY_LIMIT=2` + `BASIC_MOCK_WEEKLY_LIMIT=2` (`src/lib/tiers.ts`) — считают СТАРТЫ (не submit), суммарно по R+L. Авторитетная проверка — транзакционный row-lock на `profile` внутри `startAttempt` (`src/lib/exam/access.ts`, `SELECT...FOR UPDATE`, Codex-ревью закрыто); `enforceAccess` держит soft early-check тем же порогом | §4.8 | done (ручка) | продуктовое решение о значении — вместе с мерч-ключами (п.1) |
| 5 | i18n RU/UZ для UI-chrome | §11 | later | код (L, отдельная волна) |
| 6 | A11y-прогон WCAG 2.1 AA в реальном браузере (клавиатура/скринридер/контраст) | §7–8 | later | код |
| 7 | ✅ Кастомный домен — закрыт 2026-07-09: `bando.study` подключён (Porkbun DNS, Vercel apex+www с 308-редиректом), `NEXT_PUBLIC_SITE_URL` обновлён и redeploy сделан, Supabase Auth URL Configuration + Google OAuth Authorized origins на новый домен, Brevo sender/DKIM/DMARC и PostHog не требовали изменений. Старый `ielts-rho-seven.vercel.app` оставлен как fallback-алиас (307 → bando.study). Верифицировано: TLS/headers/robots/sitemap/health curl'ом + вручную signup/reset-письма и вход | — | done | нет |

### 12.2 Новые фичи (в брифе не было — добавлены в скоуп)

1. ✅ **План до target band** — закрыт 2026-07-08: общий билдер
   `src/lib/progress/band-plan.ts` (чистое ядро `computeBandPlan` + owner-обёртка
   `getBandPlan`), дашборд-карточка PlanCard и секция в weekly digest едят один
   контракт (most-recent-first, cap 20) → одна retention-петля с 12.1 п.2.
2. ✅ **Spaced-повтор ошибок** — закрыт 2026-07-08: таблица `mistake_review` (0044,
   SM-2-ядро `reviewCard` как у `saved_word`), server action `reviewMistake`
   (due-гейт против спам-градуации, SR-строки только для реально проваленных
   вопросов), очередь Due now / Coming up на `/app/practice/mistakes`, graduation
   (3×good) авто-закрывает ошибку в `mistake_resolution` → кормит W2-5-бейджи (0045).
3. **Student Telegram-бот (W1-5b, BACKLOG)** — вернуть в очередь: условие «после
   Волн 2–3» выполнено (Волна 2 закрыта 6/7).
4. ✅ **Notifications-переработка + upgrade-разруливание** — закрыто 2026-07-08
   (`ad6b475..72407ab`, миграции 0046/0047): уведомления действенные (typed payload,
   `data.href`, поштучное прочтение), страница `/app/notifications` (keyset-пагинация,
   фильтр), focus-refetch бейджа, атомарный дедуп (`dedup_key`), streak-reminder (§11 —
   был мёртвым enum), retention 90д, RLS UPDATE ужат до `read_at` + снят default-priv
   дрейф; digest получил outbox-retry (atomic claim-before-send). Upgrade: гейт
   `paymentsLive` + waitlist (12.1 п.1), truth-pass копирайта, события
   `checkout_blocked`/`payment_failed`. **Trial-лейн §4.8 реализован**: Basic — ровно
   один бесплатный gated full-mock (`src/lib/exam/trial.ts`, advisory-lock против гонок,
   каталог ведёт в тест с бейджем «Free trial»); все full-моки на проде закрыты
   `tier_required='premium'` (data-fix). Каждая волна прошла Codex-ревью (2 critical
   в trial-лейне зачинены до пуша).

### 12.3 Рекомендованный порядок

1. ✅ **Email-блок** (12.1 п.2) — закрыт целиком 2026-07-08: код + полка владельца
   (2026-07-07), активация Brevo + доводка чеклиста (2026-07-08).
2. ✅ **Учебная петля** — закрыта 2026-07-08 (`320217a..53e9968`): W2-5 бейджи +
   план до target band (12.2 п.1) + SR-повтор ошибок (12.2 п.2); дифф прошёл
   адверсарное ревью, 5 находок зачинены (`dffeaf4`, `53e9968`).
3. **Контент-процесс W2-3 (BACKLOG)** — теперь главный открытый фронт: без объёма
   контента остальное упирается в потолок. Процессный (ритм пополнения + витрина
   «новое»), кодом закрывается лишь частично.
   **2026-07-10 — контент-вайп**: по решению владельца прод-каталог R/L и весь прогресс
   обнулены (30 content_item / 1017 вопросов + каскад; попытки, бейджи, лига, уведомления;
   агрегаты profile сброшены) под чистую перезаливку клиентом через импорт-пайплайн.
   Аккаунты (auth.users/profile), vocab-, writing-/speaking-каталоги и saved_word не тронуты.
   Схема не менялась (только DELETE строк, транзакция с пре-чеком по подтверждённым
   цифрам). Последний pg_dump со старым контентом хранится до ~2026-08-09
   (artifact retention 30д), после — старое состояние невосстановимо.
4. ✅ **Предзапусковая волна P1–P6 + mobile-гейт** — закрыта 2026-07-11 (`8bc63e0..be747df`),
   под стелс-запуск на разовую тёплую волну ~600 из 2 ТГ-каналов клиента (заливка контента
   клиентом шла параллельно — часть пунктов ушла в срочный режим). **P1 Storage-гигиена:**
   `scripts/storage-orphans.ts` вычистил 758.5 MB сирот (Storage 762→3.4 MB из 1024,
   закрывает BACKLOG OPS-1); кап 15 MB на mp3 при импорте. **P2 QTYPE hard-block:**
   publish блокируется на пустом/нераспознанном qtype, `docs/authoring-spec.md` для клиента
   (закрывает BACKLOG W2-3b). **P3 Digest-cron:** диагноз показал ложную тревогу (piggyback
   на `snapshot-ranks` by design, не регрессия) — выделен собственный крон. **P6 Pre-order +
   тихие поломки:** guest `/pricing` видит early-bird, `preorder` несёт `source_page`,
   `signup_throttle` чистится кроном, `pg_advisory_xact_lock` в trial-гейте заменён атомарным
   `trial_claim` (`0054`), `SIGNUP_THROTTLE_MAX` поднят 10→100/час/IP под CGNAT-волну (подпись
   владельца). **P5 Атрибуция каналов:** `?src=<slug>` → cookie → `source` в PostHog на
   signup. **P4 Mobile release-gate:** 3 golden path пройдены автоматикой + живым проходом
   владельца на реальном телефоне; 2 major-находки (плавающий тулбар аннотаций на тач в
   mock-режиме, широкая matching-таблица утаскивала инструкции скроллом) зачинены —
   разрешает BACKLOG-гипотезу H4. Каждая задача — Codex-ревью + verify. Остаточное на полке
   владельца: две ссылки `?src=` в посты каналов, Listening-прогон после заливки аудио,
   merchant-ключи (п.1 ниже).

**Полка владельца** (кодом не решается): merchant-ключи Payme/Click/Uzum,
Apple/Facebook dev-аккаунты, SMTP-провайдер + тумблер Confirm в Supabase,
Cloudflare Turnstile-ключи (анти-бот seam готов), две `?src=`-ссылки для постов в
Telegram-каналы (атрибуция притока, §12.3 п.4).
