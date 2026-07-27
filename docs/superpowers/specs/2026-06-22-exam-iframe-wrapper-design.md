# Exam iframe-wrapper — дизайн

> Дата: 2026-06-22. Статус: утверждён в брейнсторме, ждёт вычитки перед планом.
> Трек: полная переделка процесса и вида Reading/Listening «точь-в-точь» как
> эталонные computer-delivered IELTS HTML-файлы. **BRIEF на этом треке отложен**
> (явное решение пользователя): источник истины для экзамена — эталонные HTML.

## 1. Проблема

Текущий пайплайн парсит загруженный HTML-файл теста в БД (passage/question/
answer_key) и **перерисовывает** вопросы своим React-раннером. При этом теряется
~90% оригинала: drag-drop, single-pass аудио с привязкой таймера, split-screen с
ресайзом, темы, размеры шрифта, highlight, навигация по частям. Свежий трек
`questions_html` тащит только разметку панели вопросов и падает в фоллбэк на любом
drag-drop.

Эталонные файлы (`Cambridge 21 Listening Test 1.html`, `Cambridge 21 Test 1 -
Full Reading Test.html`) — это **законченные интерактивные тренажёры**: вся
механика и вид живут в их встроенном CSS+JS. Цель — отдавать студенту этот опыт
без расхождений.

## 2. Зафиксированные решения

| # | Вопрос | Решение |
|---|---|---|
| 1 | Подход | **Обёртка (iframe)** — файл запускается как есть, не переписываем в React |
| 2 | Источник контента | Каждый тест приходит готовым интерактивным HTML этого шаблона |
| 3 | Старый контент в БД | Залить заново; старый формат выводится из эксплуатации |
| 4 | Объём копии | Всё из эталона (темы, размеры, Practice/Mock, highlight, drag-drop, single-pass) |
| 5 | Autosave/resume | localStorage внутри iframe (тот же браузер); серверного autosave нет |
| 6 | Грейдинг | Сервер считает по answer_key в БД; ключи вырезаются из файла при импорте |
| 7 | Аудио (listening) | Перезаливаем в наш Supabase Storage, подменяем `<audio src>` |
| 8 | Философия | Как в эталонном HTML; BRIEF-требования (cross-device resume, server-trusted timing, строгий анти-чит) пока не тащим |

**Остаётся обязательным независимо от BRIEF** (продуктовая необходимость, не
требование брифа): ключи прячем + грейдим на сервере. Иначе студент видит ответы
в коде страницы (F12), а bando-result и рейтинг/лидерборд/tiers теряют смысл.

## 3. Архитектура: два мира

```
НАШ SHELL (Next.js parent, наш origin)
  • auth / tier-гейт / daily-limit / старт attempt (server-stamped)
  • рендерит <iframe sandbox="allow-scripts allow-same-origin allow-modals"
                     src="/app/exam/[id]/runner">
  • слушает window.message → при type='submit' вызывает server action grade
  • redirect → bando-result (наш)

  └─ IFRAME (наш origin, route /runner отдаёт ОЧИЩЕННЫЙ файл)
       • оригинальные HTML+CSS+JS как есть: вид, темы, drag-drop, аудио, таймер
       • localStorage resume (их)
       • + ИНЖЕКТИРОВАННЫЙ МОСТ: перехват их submit → postMessage наверх
       • ключи вырезаны → грейдить нечем, отчёт их подавлен
```

Две границы, и только две:
- **вход** в iframe = очищенный файл (без ключей, с нашим аудио, с мостом);
- **выход** из iframe = одно сообщение `postMessage({type:'submit', answers})`.

Внутрь iframe снаружи не лезем; их код наш стек не видит.

## 4. Поток импорта (админка / Telegram-бот)

Тот же вход (HTML-файл теста), новый pipeline:

```
HTML-файл
 ├─ 1. Извлечь ключи (переиспользуем src/lib/import/extract-js.ts):
 │      Listening: KEY, band()
 │      Reading:   correctAnswers, acceptableAnswers, explanations, evidence,
 │                 questionTypes, getBandFor40()
 │      → answer_key (mode/accept/explanation/evidence) + band_scale в БД
 ├─ 2. Аудио (listening): скачать mp3 по внешнему <audio src> →
 │      Supabase Storage (PUBLIC bucket `audio`, service-role) → наш public URL
 ├─ 3. Очистить файл (новый шаг, src/lib/import/sanitize-runner.ts):
 │      a) вырезать/обнулить объявления ключей: `const KEY = {}` и т.д.
 │         (балансировка скобок из extract-js; функции band/getBand → заглушка)
 │      b) подменить <audio src> на наш URL
 │      c) инжектировать МОСТ по детектированному шаблону (см. §6)
 │      d) уникализировать их STORAGE_KEY → `..._<content_item.id>` (иначе resume
 │         одного теста затрёт прогресс другого — STORAGE_KEY зашит в шаблоне)
 │      e) удалить внешний <script src> html2pdf (cdnjs) — их PDF/share не
 │         используем; минус внешний запрос, проще CSP
 │      → runner_html (безопасный для отдачи)
 ├─ 4. ГЕЙТ безопасности: прогнать runner_html — ни одного значения из answer_key
 │      не встречается в скрипт-секции. Иначе импорт падает (защита от утечки).
 └─ 5. Persist: content_item (+ runner_html), лёгкие question + answer_key,
        passage-контейнер (для FK), status='draft' → админ публикует
```

Детектор шаблона — как сейчас `parseTest`: Listening по `<audio>`+`.part`,
Reading Full по `.passage-section`. Эти два шаблона = два варианта инъекции моста.

## 5. Поток прохождения (runtime)

```
Студент жмёт «Начать тест»
 → parent: tier-гейт + daily-limit + ensureAttempt (server-stamped started_at)
 → страница экзамена рендерит <iframe src="/app/exam/[id]/runner">
 → route /runner: проверяет доступ (auth+tier+ownership), отдаёт runner_html (text/html)
 → их JS поднимается: вид/процесс/таймер/drag-drop/аудио — точь-в-точь
 → прогресс пишется в localStorage (resume в том же браузере)
 → студент жмёт их «Submit/Deliver» (или авто-сабмит по таймеру)
      → МОСТ перехватывает, собирает {номер: значение} через их getAnswer/getUserAnswer,
        шлёт parent: postMessage({type:'submit', answers}); их отчёт подавлен
 → parent: server action grade(answers по answer_key) → raw/band/perType
      → пишет attempt; rating/leaderboard/badges (переиспускаем существующее)
 → redirect → наш bando-result
```

Tiers, idempotent submit, single in_progress, submit rate-limit — **переиспускаем
существующие**: они на parent/сервере, к механике файла отношения не имеют.

`attempt` создаётся на старте для записи результата, но промежуточный autosave в БД
НЕ идёт (resume — localStorage). На сабмите ответы приходят из iframe; сервер
считает elapsed как `submittedAt - startedAt` для записи (без enforcement).

## 6. Мост (узел, переписанный после проверки на файлах)

Мост — это **внешний `<script>`, добавляемый в конец файла при очистке** (НЕ
инъекция внутрь IIFE: их перехват-точки доступны снаружи). Ответы собираются
прямым обходом DOM по их селекторам — мост не зависит от их scope/функций. Две
версии по детектированному шаблону:

**Reading** (функции `showResults`/`markOnPage` — глобальные function declarations):
- перехват: `window.showResults` → сбор+postMessage; `window.markOnPage` → no-op
  (её зовут оба пути сабмита — `autoSubmitMock` и handler deliver-кнопки — до
  `showResults`; no-op гасит разметку по уже вырезанным ключам);
- сбор ответов из DOM: `input.inspera-input-text[name="qN"]` (текст),
  `input[name="qN"]:checked` (radio TFNG/MCQ/matching),
  `.dd-blank[data-q="N"] .drag-token[data-value]` (drag select).

**Listening** (логика в IIFE, но сабмит-точка — свойство DOM-элемента):
- перехват: `document.getElementById('doSubmit').onclick` → сбор+postMessage
  (авто-сабмит по таймеру зовёт тот же `onclick`, стр 1466 эталона);
- сбор ответов из DOM: `input.gap[data-q="N"]` (текст),
  `.mcq input[name="qN"]:checked` / checkbox (radio/multi),
  `.dropzone[data-q="N"][data-value]` (drag matching).

Формат собранных ответов — `{ "N": value }`, value = буква / текст / для multi —
массив букв; совместим с нашим грейдингом (`mcq_set`/`text_accept`/`exact`,
нормализация trim/upper/collapse) по всем типам — проверено на обоих файлах.

«Контракт шаблона» (стабильные точки `showResults`/`markOnPage`/`#doSubmit`,
селекторы выше) фиксируется в этом spec; будущие файлы обязаны ему следовать.
Если sanitize не находит перехват-точку — импорт падает с понятной ошибкой.

## 7. Изменения схемы БД (минимальные)

- **+1 колонка**: `content_item.runner_html text` — очищенный файл. (Версионирование
  отдельной таблицей — YAGNI, при надобности позже.)
- **answer_key / question** — переиспускаем как есть; question.number — ключ
  грейдинга. Импорт создаёт лёгкие `question` (number + qtype + answer_key,
  опц. prompt_html для разбора в bando-result) + один passage-контейнер для FK.
- **`passage.questions_html`** (verbatim-трек) — в новом потоке не нужен; не удаляем
  сразу, чистим отдельной миграцией позже.
- Отдача `runner_html` — только через авторизованный route (гейт по tier); НЕ
  публичный Storage URL (контент платный). Аудио остаётся в публичном bucket.

## 8. Узлы реализации (выбор)

| Узел | Выбор | Почему |
|---|---|---|
| Вырезание ключей | Балансировка скобок из `extract-js.ts` → объявление → пустышка `={}`; функции → заглушка | Ноль новых зависимостей, детерминировано; пустышка вместо удаления — чтобы JS не падал |
| Хранение файла | БД `text` + авторизованный route | Транзакционно с answer_key, гейт по tier, без лишнего хопа в Storage |
| Отдача в iframe | Отдельный route как `src` (не `srcdoc`) | Чище, кэшируемо, не раздувает родительский HTML |
| Мост | Инъекция при очистке по шаблону (см. §6) | Работает в обоих scope; переиспускает их же сбор ответов |
| Sandbox | `allow-scripts allow-same-origin allow-modals` | localStorage + аудио требуют same-origin; `allow-modals` — для их `confirm()` при сабмите (часть эталонного UX); контент доверенный (из админки) |

## 9. Риски и закрытие

1. **Утечка ключей (критично)** → автотест-гейт при импорте (§4 шаг 4): в runner_html
   нет ни одного ответа из answer_key. Без прохождения — импорт не проходит.
2. **Два разных submit-механизма** → мост по шаблону (§6), а не универсальный
   monkey-patch. Покрывает кнопку и авто-сабмит в обоих файлах.
3. **Стабильность шаблона** → «контракт шаблона» зафиксирован (§6); отклонение
   ловится при импорте (мост не находит точку → импорт падает с понятной ошибкой).
4. **iframe + аудио + CSP** → `allow-same-origin` + media-src на наш Storage в CSP
   для /runner; лишнее не пускаем.
5. **Коллизия localStorage между тестами** → STORAGE_KEY зашит в шаблоне; при
   очистке уникализируем его под `content_item.id` (§4 шаг 3d).

## 10. Вне scope (этого трека)

- Cross-device resume, server-trusted timing enforcement, строгий анти-чит (BRIEF —
  отложено решением пользователя).
- Версионирование/re-grade очищенных файлов.
- Чистка legacy-полей (`questions_html`) и старого React-раннера — отдельным шагом
  после переезда.
- Writing/Speaking (Phase 3, заморожен).

## 11. Критерий готовности

Студент проходит реальный Cambridge-тест (reading и listening) в iframe — вид и
процесс неотличимы от эталонного файла; ключей в отданном коде нет; на сабмите
сервер считает балл/band/разбивку и показывает bando-result; рейтинг/лидерборд/
tiers работают как раньше.
