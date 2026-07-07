# PRACTICE_PLAN — трек «богатый Practice-режим R/L»

> Синтез двух независимых проработок (fan-out 2026-07-07) + инвентаризация кода +
> замер прода. Инварианты — BRIEF §4.3/§4.6/§6.1 (не пересказываются здесь).
> Mock-путь НЕ меняется; все фичи — только в ветке Practice.

## Решения владельца (2026-07-07, делегированы исполнителю)

1. **Стратегия A**: Mock = iframe-раннер (fidelity), Practice = атомизированная
   поверхность (наш React-раннер) после backfill. Bridge-инъекции — точечный
   инструмент, не стратегия.
2. MVP = срез 1 (фундамент) + срез 2 (обучающая петля).
3. **Daily-cap Basic считает только mock**; practice бесплатен и безлимитен
   (анти-абуз — submit-throttle). Рейтинг: mock ∧ абсолютно первая сданная
   попытка теста (любого режима) ∧ не too-fast — practice «сжигает»
   рейтингуемость теста (анти-накрутка под будущие practice-подсказки).
4. Визуальная проверка — на Vercel-проде, реальным браузером.

## Факты, на которых стоит план (проверено 2026-07-07)

- До P0 развилка Practice/Mock жила ТОЛЬКО в клиенте легаси-раннера
  (localStorage); `attempt.mode` писался хардкодом `"practice"`; рейтинг/кап/
  результат по режиму не ветвились нигде.
- **100% published-тестов (15 R + 8 L) — `runner_html`** (iframe); атомизация у
  всех пустая (`body_html`/`prompt_html` = ''). Легаси-раннер не обслуживает ни
  один published-тест. 3 строки — дубли публикаций (Cambridge 21 R Test 2/3/4 ×2).
- **Исходные HTML нигде не персистятся**: runner-импорт вычищает ключи
  (`sanitizeRunner`) и выбрасывает оригинал; `source_file_path` — строка
  идемпотентности, не путь к хранилищу. Файлы всех 23 тестов найдены в случайных
  локальных копиях (`.qa-import/`, `Downloads/`) — везение машины, не система.
- Спайк S1 (dry-run атомизации, скрипт `scripts/_spike_atomize.ts`, не коммитится):
  **5/23 атомизируются без правок парсеров**; остальные падают на 5 перечислимых
  дыр селекторов: (1) одиночный MCQ в full-reading (`.mc-question` без
  `data-mcq-group`), (2) drag-and-drop `.dd-blank`, (3) Cambridge full-reading
  одной страницей (не срабатывает `isFullReading()` + пустые промпты в
  single-ветке), (4) matching-таблицы `.stmt-text` вместо `.q-text`,
  (5) listening `place-chip`/checkbox-группы (map labelling / choose-TWO).
- Шаблон runner_html НАТИВНО поддерживает авто-старт режима:
  `sessionStorage['pendingMode']` → `beginTest(mode)` (его retake-механизм) —
  использован в P0 (`force-mode.ts`) вместо хрупких клик-хаков.

## Каталог фич (сведение, ранжировано)

| # | Фича | Слож. | Поверхность | Статус |
|---|---|---|---|---|
| P0 | Режим — серверная сущность: ModeStart до создания attempt, `attempt.mode`, рейтинг mock-only-first, кап mock-only, sync внутреннего режима iframe | S–M | обе | ✅ срез 1 |
| P1 | Format guard: live-подсказки лимита слов / числа выборов (ключ не трогается; `src/lib/exam/format-guard.ts`) | S/M | атомиз. | ✅ срез 2 |
| P2a | Подсказки-стратегии по qtype (zero-key, `strategy-hints.ts`, collapsible в QuestionBlock) | S | атомиз. | ✅ фаза 3.A |
| P2b-1 | Локатор абзаца ПОСЛЕ reveal («Show in passage»: CustomEvent → PassagePane резолвит `#para-N` / `.rp[data-letter]`, императивный пульс) | S | атомиз. | ✅ фаза 3.A |
| P2b-2 | Локатор ДО reveal (отдельный action, qtype-гейт против para=answer) | M | атомиз. | отложен (сперва замер покрытия `evidence` на проде) |
| P3 | Свобода таймера: practice = счёт вверх + пауза (Reading с P0; Listening — с P8) | S | атомиз. | ✅ срез 1–2 |
| P4 | Комфорт чтения: шрифт/интерлиньяж/тема (панель «Aa», `bando-reading-prefs`) | S | атомиз. | ✅ срез 2 |
| P5 | Микро-цели и брейки | S/M | обе | фаза 3 |
| P6 | Мгновенная проверка ответа: `checkAnswer` → только boolean; owner+in_progress+practice в WHERE; нормализация = `gradeOne` (общая с submit) | M | атомиз. | ✅ срез 2 |
| P7 | Ответ+объяснение по клику: `revealQuestion` — accept/explanation/evidence ОДНОГО вопроса | S–M | атомиз. | ✅ срез 2 |
| P8 | Listening Lab: пауза/seek/replay/скорость в practice; mock single-pass байт-в-байт | M | атомиз. | ✅ срез 2 |
| P9 | Повтор ошибок: lite — drill по `q_type` из result; rich — очередь (миграция) | S/L | обе | фаза 3 |
| P10 | Confidence-метки → калибровка на result | M | атомиз. | фаза 3 |
| P11 | Слово → Vocabulary (SM-2, новая owner-таблица, миграция; RLS + pg_policies!) | L | атомиз. | фаза 3 |
| P12 | Practice-результат без band-давления (learning-фрейм: диал в pct, без share/`→ Band N`) | S | обе | ✅ фаза 3.A |
| P13 | Format-loss callout на practice-результате («Format cost you N» — `src/lib/result/format-loss.ts` поверх format-guard, server-side) | S/M | атомиз. | ✅ фаза 3.A |
| P14 | Second try: reveal-ссылка после верного ИЛИ 2-го неверного чека («Check again») | S | атомиз. | ✅ фаза 3.A |
| OwnA | Pacing coach: чип темпа у practice count-up (Reading; цель = duration/кол-во Q; выкл. в «Aa») | S | атомиз. | ✅ фаза 3.A |
| P15 | Focus deep-link `?focus=QN` в practice-попытку (навигация для P9/result) | M | атомиз. | фаза 3.B |

Tier: всё free (practice+разбор бесплатны). Premium-леверы потом: транскрипты,
безлимит saved words, rich-очередь ошибок.

## Срезы

**Срез 1 — фундамент (P0)** — ✅ реализован (см. git):
mode до создания attempt (`?mode=` + ModeStart для обоих раннеров и Listening),
`startAttempt(mode)`, `shouldRateAttempt` (unit-тесты), кап mock-only +
честная копия limit-баннера, `forceRunnerMode` (pendingMode + скрытие
mid-test переключателя), бейдж режима в Listening.

**Срез 2 — обучающая петля** — ✅ реализован (2026-07-07, см. git):
1. ✅ Исходники: приватный bucket `source-html`, заливка в `importRunner`
   (admin/Telegram/CLI одной точкой), backfill 23/23
   (`scripts/backfill-source-html.ts`).
2. ✅ Парсеры: все 5 дыр закрыты аддитивно, 23/23 published атомизируются.
   Backfill данных выполнен на проде (`scripts/backfill-atomize.ts`: гейт по
   множеству номеров, update-only-empty, транзакция на тест, `answer_key`
   не тронут; `--fix-qtype` выровнял qtype-расхождения runner-импорта —
   исторические `per_type_breakdown`-снапшоты не переписывались).
3. ✅ Роутинг: practice → `/app/reading/[id]` при наличии атомизации (для
   listening — ещё и `passage.audio_path`; 6/8 listening проходят, 2 остаются
   practice-lite в iframe). Mock всегда iframe.
4. ✅ P6+P7 (deep-reasoner, Codex-ревью), P8+P1+P4 (deep-reasoner, Codex-ревью).

**Хвосты среза 2:** дубли публикаций — ✅ закрыто 2026-07-07 (3 старших копии
Cambridge 21 R Test 2/3/4 от 07-01 депубликованы в `draft`, у каждой была лишь
1 in_progress-попытка); баг highlight/note — ✅ закрыт `cb41db2` (тела пассажей
за memo `PassageBodies`; визуальная приёмка на проде — за владельцем); 2
listening без `audio_path` (C21 L Test 3 `4822778c…`, Test 4 `900bd8a4…`) —
ждут mp3 от владельца (Telegram-бот, bucket `audio`, ключ `<id>.mp3`);
транскрипты Listening — контента нет.

**Фаза 3 (2026-07-07, план от fan-out Opus+Codex, сведён):**
- **Волна A — ✅ реализована** (без миграций, всё в practice-ветках):
  P12+P13 (result-зона, коммит `590f515`), OwnA+P2a+P14+P2b-1 (runner-зона,
  коммит `c09bd76`). Mock-рендер не тронут; server actions не менялись.
- **Волна B — ✅ реализована** (коммиты `0f58023`/`4c15713`/`c696474`; Codex
  adversarial-ревью пройдено — 2 major закрыты фиксами): P9-rich «вариант B»
  (submit НЕ тронут; `0040_mistake_resolution` — только резолюции; деривация
  из снапшота; резолюция гасит лишь попытки, сданные ДО неё → re-fail
  переоткрывается, forged-впрок инертен; qtype — server-lookup из `question`),
  экран `/app/practice/mistakes` (href по каталожному правилу через диспетчер
  `/app/exam`), P15 `?focus=QN`. `0040` применена на прод ДО пуша, постура
  `pg_policies` проверена ([OK]).
- **Волна C** — P11 saved words (`0041_saved_word`, SM-2 через `srs.ts`,
  дек «My words», БЕЗ синтеза `vocab_card`).
- Оппортунистически: P10 (localStorage-остров), OwnC weakness heatmap, P5
  (локальная форма, без XP). P2b-2 — после замера покрытия `evidence`.

## Риски (актуальные)

- Парсимость новых шаблонов: закрывается расширением под 5 дыр + fallback
  practice-lite; residue-гейт при импорте по образцу `runnerBrandResidue`.
- Mock-регрессия: форк-условия покрыты unit-тестами (`shouldRateAttempt`,
  `forceRunnerMode`); mock-ветки таймера/аудио в ExamRunner не менялись.
- Rating-переход: прод-строки все `mode='practice'` (историческое значение);
  их авторы уже отрейтингованы старым правилом; новые mock рейтингуются только
  на не-игранных тестах — честно по §4.6.
- Supabase default-priv grants на новые таблицы (P11) — проверять `pg_policies`
  на проде, local verify не ловит.
