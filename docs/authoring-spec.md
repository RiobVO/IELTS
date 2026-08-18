# Authoring-спека: HTML-файл теста для импорта

Требования к самодостаточному HTML-файлу Reading/Listening-теста, который загружается
через Telegram-бота (или `/admin`). Основа — [BRIEF.md](../BRIEF.md) §4.2/§4.2.1; здесь —
практический чек-лист для того, кто готовит файл, без пересказа всей спеки.

## Формат файла

Один тест — один самодостаточный HTML-файл по единому шаблону (тот же, что уже
используется: классы `tfng-`/`mcq-`/`inspera-`, `STORAGE_KEY`), с JS-объектами в конце
файла (`<script>`):

- `correctAnswers` — правильный ответ на каждый вопрос (`{"1": "TRUE", ...}`).
- `acceptableAnswers` (Reading) / `acceptableVariants` — допустимые варианты формулировки
  для текстовых ответов (`{"4": ["journal", "journals"]}`).
- `mcqGroups` — для «choose TWO/THREE answers»: диапазон вопросов + набор правильных букв
  (`{"8-12": {"qs": [8,9], "correct": ["A","D"]}}`). **Обязателен** для любого MCQ-вопроса
  с несколькими правильными ответами — массив в `correctAnswers` без соответствующей записи
  в `mcqGroups` парсер помечает warning'ом (грейдинг деградирует до одиночного ответа).
- `questionTypes` (Reading) / `QTYPE` (Listening) — тип вопроса, **обязателен для каждого
  вопроса** (см. ниже).
- `explanations`, `evidence` — разбор ответа + ссылка на абзац/цитату пассажа (используются
  на `/result`; отсутствие не блокирует публикацию, но обедняет разбор).
- `getBandFor40` (Reading) / `band` (Listening) — таблица перевода raw score → band для
  полного 40-вопросного теста (не нужна для отдельного passage/part).

## QTYPE обязателен — главное требование

**Каждый вопрос обязан иметь непустой, распознаваемый тип в `questionTypes`/`QTYPE`.**
Пустой или нераспознанный тип **блокирует публикацию теста** — админ увидит ошибку и не
сможет опубликовать, пока файл не будет исправлен и перезалит. Это не смягчается: тип
вопроса используется на `/result` для разбивки «по типу вопроса» (где студент теряет
баллы) — без него эта диагностика молча схлопывается в один тип для всего теста.

Грейдинг (правильно/неправильно) от `questionTypes` не зависит — он работает по
`correctAnswers`/`acceptableAnswers`/`mcqGroups`. Но публикация всё равно требует
корректный QTYPE, потому что без него ломается ключевая аналитика для студента.

### Принимаемые ярлыки

Ярлык матчится нечувствительно к регистру/пунктуации/пробелам. Используйте любой из
вариантов ниже (или их очевидные написания — парсер нормализует лишние слова/дефисы, но
не гадает произвольный текст):

| Ярлык (любой из вариантов) | Канон-тип |
|---|---|
| `True / False / Not Given`, `TFNG` | `tfng` |
| `Yes / No / Not Given`, `YNNG` | `ynng` |
| `Multiple Choice`, `Multiple Choice (single)` | `mcq_single` |
| `Multiple Choice (multiple)` | `mcq_multi` |
| `Multiple Choice (TWO answers)`, `(THREE answers)` — **требует `mcqGroups`** | `mcq_multi` |
| `Matching Headings` | `matching_headings` |
| `Matching Information` | `matching_info` |
| `Matching Features`, `Classification`, `Matching Researcher` | `matching_features` |
| `Matching Sentence Endings` | `matching_sentence_endings` |
| `Sentence Completion` | `sentence_completion` |
| `Summary Completion` | `summary_completion` |
| `Note Completion`, `Notes Completion` | `note_completion` |
| `Flowchart Completion` | `flowchart_completion` |
| `Table Completion` | `table_completion` |
| `Diagram Label Completion`, `Diagram Labelling` | `diagram_label` |
| `Map Labelling`, `Plan / Map / Diagram Labelling`, `Map/Plan labelling`, `Plan/Map labelling` | `map_labelling` |
| `Form Completion` | `form_completion` |
| `Short Answer`, `Short Answer Questions` | `short_answer` |

Таблица одинакова для Reading и Listening — какие типы фактически встречаются в
конкретном тесте, зависит от секции (Listening чаще несёт `table_completion`,
`form_completion`, `map_labelling`, `note_completion`; Reading — `tfng`, `matching_*`,
`mcq_*`). Полный маппинг, включая нечёткие (substring) варианты — источник правды —
`src/lib/import/question-types.ts`.

Ярлык, похожий на один из вариантов, но не точный (например, «Section 2 — Note
Completion»), тоже распознаётся, но помечается warning'ом «low-confidence» для ревью —
это **не блокирует** публикацию, в отличие от пустого/полностью нераспознанного типа.

## Аудио (Listening)

- Один mp3 на весь тест (аудио прикладывается к первому passage — не к каждому вопросу
  отдельно).
- Лимит размера — **12 MB** (жёсткий кап и при встроенном `<audio src>` в HTML, и при
  отдельной заливке mp3-файлом через бота — `src/lib/import/audio-cap.ts`).
- Целевой профиль — **mp3, mono, 48 kbps, 32 kHz**: полный Listening-тест (~30+ минут) на
  этом профиле укладывается в ≈10.8 MB, оставляя запас до лимита. Ниже 48 kbps не
  опускайтесь — разборчивость речи прямо влияет на баллы. Несжатый/стерео/более высокий
  битрейт в лимит не влезает — пережимайте перед заливкой:

  ```bash
  ffmpeg -i input.mp3 -ac 1 -ar 32000 -b:a 48k output.mp3
  ```

  Пережатие нужно для бюджета трафика и хранилища (Storage 1 GB, egress 5 GB/мес на
  Supabase Free) — при этом на 48 kbps mono речь остаётся полностью разборчивой.
- Если HTML не несёт аудио — бот примет файл как черновик и попросит прислать mp3
  отдельным сообщением следом.
