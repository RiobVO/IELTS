# REDESIGN2.md — Exam-runner → «процесс точь-в-точь как настоящий computer-IELTS»

> Активный трек прокачки exam-раннера (Reading + Listening). Работаем **строго по нему**,
> один под-шаг = коммит+пуш в `main` + автогейт. Старый `REDESIGN.md` (визуальный редизайн
> 6 экранов) — закрыт, к этому треку отношения не имеет.

## Контракт (правила, стоп-условия)

- **Порт раннера = ЧИСТЫЙ ФРОНТ.** БЕЗ новых миграций/схемы/сигнатур server-actions/RLS.
  Аннотации (highlight/notes) уже в БД (`0013_annotation`) — это сделанное исключение, не трогаем.
  Если аффорданс требует новую схему/эндпоинт → СТОП, вынести вопросом.
- **Грейдинг остаётся СЕРВЕРНЫМ.** Референсы держат `KEY`/`correctAnswers` + `isCorrect()`/
  `band()`/`computeReport()` в клиентском JS — **не переносим** (§6.1/§4.6). `answer_key`
  никогда не уходит в клиент. Перенос клиентского ключа = стоп-условие.
- **Не трогаем:** `result/review` (Волна 1: per-type breakdown, open-флаг), каталог/дашборд/
  лигу/бейджи, соседний код. Раннер заканчивается сабмитом → ведёт на существующий bando-результат.
- **Вид:** editorial **bando** (решение пользователя — A). Серый Cambridge-скин (B/C) —
  отдельно на шаге 4, на живом прод-показе, editorial раньше не выкидываем.
- React, существующие токены/компоненты, inline-стили. **НОЛЬ новых runtime-зависимостей**
  (`package.json` не трогаем). Mobile/responsive раннера — НЕ в этом треке (не ломать существующий).
- Аудио — из Supabase Storage; premium-аудио — signed URLs.
- Идентификаторы/коммиты по-английски, без AI-атрибуции. Общение по-русски.

## As-is раннера (что уже есть — не дублировать)

- Reading + Listening — **один** раннер `app/app/reading/[id]/` (`ExamRunner.tsx`); Listening
  определяется наличием `passage.audio_path` (`isListening = !!audioSrc`). Отдельного listening-роута нет.
- `PassagePane` переверстан в editorial bando (masthead, drop-cap, буквы абзацев, reading-progress, tool-капсула).
- Highlight/notes **персистятся в БД** (`0013_annotation`, server-actions, `wrapOffsets` на mount) — переживают reload.
- Размер шрифта A−/A+ и темы (paper/sepia) — есть (localStorage, `bando-reading-size`/`bando-reading-theme`).
- Серверный грейдинг (`submitAttempt` читает `answer_key` owner-путём), серверное время от `started_at`,
  autosave (debounce 1500ms), resume (`ensureAttempt`, idempotent), идемпотентный submit — **работают**.
- Флаг review **есть**, но клиентский/эфемерный (не персистится между сессиями) — для трека ок.
- Single-pass: waveform некликабелен (нет seek), **но пауза разрешена** → строгий проход недоделан.
- Таймер — wall-clock (`elapsed` +1s), не привязан к аудио. Transfer-time нет.

## Gap → аффордансы

| Аффорданс | В референсе | У нас сейчас | План порта | Риск для логики |
|---|---|---|---|---|
| Нижний навигатор 1–40 full-width + Part-группы + review-флаги | да (футер) | сбоку (панель 460px)/inline, флаг есть | вынести в нижнюю полосу full-width, группы по Part, состояние то же | нет (чистая презентация) |
| Practice/Mock + start-screen | да (Reading) | один режим, `mode` зашит `practice` | start-screen + тоггл; **Mock — клиентский UI**, mode в БД не пишем | нет (`ensureAttempt` не трогаем) |
| Listening строгий single-pass + буфер + audio-таймер | да | no-seek есть, пауза разрешена, wall-clock | запретить паузу, буфер-%, таймер от `audio.currentTime` | нет (серверное время — истина) |
| Listening transfer-time (check-phase) | да (2 мин → авто-сабмит) | нет | пост-аудио окно → авто-сабмит (зовёт существующий submit) | нет (клиентская фаза) |
| Вид: editorial vs серый Cambridge | серый | editorial bando | решение B/C на шаге 4 (живой показ) | нет (чистый скин) |

## Под-шаги (☐ todo / 🔄 в работе / ✅ done)

1. ✅ **Нижний навигатор 1–40 full-width** — Part-группировка, review-флаги, состояние то же
   (`QuestionNavigator` перепрофилирован side→footer; `passage_id` добавлен в read вопросов).
2. ☐ **Practice/Mock + start-screen** (Reading-first) — Mock = клиентский countdown + авто-сабмит
   через существующий `submitAttempt`; mode в БД НЕ пишем.
3. ☐ **Listening строгий single-pass + буфер + audio-таймер + transfer-time** — refresh = резюм с
   серверной позиции / форфейт (не реплей); длительность окна подтвердить (предложу 2 мин).
4. ☐ **(опц.) скин-проход** — решение B/C на живом прод-показе, последним.

## Открытые риски / решения (зафиксировано 2026-06-21)

- **mode → `ensureAttempt`:** НЕ трогаем. Mock — чисто клиентский UI. Писать `mode='mock'` в БД —
  только если позже понадобится отличать «сдал под экзаменом» в аналитике (отдельная задача).
- **Listening refresh:** резюм с серверной позиции **или форфейт**, не рестарт. Реальный IELTS = один проход.
- **transfer-time длительность (шаг 3):** Cambridge-sim = 2 мин check-phase. Предложу 2 мин, подтвердить.

## Замки

- **Baseline `npm test`:** 11 файлов, **97 passed / 4 skipped** (exit 0) — эталон «как было».
- **Автогейт каждого шага:** `npx tsc --noEmit` + `npm run build` + `npm test` — все зелёные,
  тот же baseline (`build` НЕ при живом `dev`).
- **Инварианты (поведение идентично):** server-grading, server-time, autosave/resume, idempotent submit,
  RLS, tiers, рейтинг, аннотации, Волна 1 (result/review).
