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
| P1 | Format guard: live-проверка лимита слов / числа MCQ-выборов / пустых (ключ не трогается) | S/M | атомиз. | срез 2+ |
| P2a | Подсказки-стратегии по qtype (zero-key) | S | обе | срез 1–2 |
| P2b | Локатор абзаца из `evidence.para` (server action, слабый leak, practice-only) | M | атомиз. | фаза 3 |
| P3 | Свобода таймера: пауза/стоп/свой лимит, включая Listening practice | S | обе | срез 1–2 |
| P4 | Комфорт чтения: шрифт/интерлиньяж/тема/focus | S | атомиз. | срез 2 |
| P5 | Микро-цели и брейки | S/M | обе | срез 1–2 |
| P6 | Мгновенная проверка ответа: server action → verdict boolean; practice+owner+in_progress; cap/throttle; brute-force гасится unrated practice | M | атомиз. | срез 2 |
| P7 | Ответ+объяснение по клику (owner-path reveal одного вопроса) | S–M | атомиз. | срез 2 |
| P8 | Listening Lab: replay/pause/seek/скорость в practice (Mock single-pass как был); транскрипт позже | M | атомиз. | срез 2 |
| P9 | Повтор ошибок: lite — drill по `q_type` из result; rich — очередь (миграция) | S/L | обе | фаза 3 |
| P10 | Confidence-метки → калибровка на result | M | атомиз. | фаза 3 |
| P11 | Слово → Vocabulary (SM-2, новая owner-таблица, миграция; RLS + pg_policies!) | L | атомиз. | фаза 3 |
| P12 | Practice-результат без band-давления | S | обе | фаза 3 |

Tier: всё free (practice+разбор бесплатны). Premium-леверы потом: транскрипты,
безлимит saved words, rich-очередь ошибок.

## Срезы

**Срез 1 — фундамент (P0)** — ✅ реализован (см. git):
mode до создания attempt (`?mode=` + ModeStart для обоих раннеров и Listening),
`startAttempt(mode)`, `shouldRateAttempt` (unit-тесты), кап mock-only +
честная копия limit-баннера, `forceRunnerMode` (pendingMode + скрытие
mid-test переключателя), бейдж режима в Listening.

**Срез 2 — обучающая петля** (после подтверждения P0 на проде):
1. Персист исходников: импорт (Telegram/CLI) кладёт raw HTML в Storage
   (`source_html/` bucket) — закрывает системную дыру воспроизводимости.
2. Расширение парсеров под 5 дыр S1 (выше) + backfill-скрипт атомизации
   по локальным копиям → `passage`/`question` заполняются для runner-тестов
   (аддитивно, ключи не трогаем; дубли публикаций почистить в /admin).
3. Роутинг Practice → атомизированный раннер (`has_runner` остаётся маршрутом
   Mock; practice atomized при наличии атомизации, иначе practice-lite в iframe).
4. P6 + P7 (server actions по шаблону vocab `answerCompletionAction`) + P8 +
   P1 + P4. Server actions пишет deep-reasoner, UI — fast-worker, ревью — Codex.

**Фаза 3** — P2b, P9-rich, P10, P11, P12, транскрипты.

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
