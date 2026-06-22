# Exam iframe-wrapper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Студент проходит Reading/Listening в оригинальном Cambridge-HTML внутри iframe (вид и процесс точь-в-точь), ключи скрыты, сервер грейдит, показывается наш bando-result.

**Architecture:** Импорт извлекает ключи в БД + перезаливает аудио в Storage + очищает файл (вырез ключей, подмена audio, инъекция моста) → `content_item.runner_html`. Runtime: авторизованный route отдаёт runner_html в `<iframe>`; мост перехватывает их submit → `postMessage` → parent зовёт существующий `submitAttempt` → bando-result.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle (owner-path), Supabase (auth + Storage), vitest, cheerio, node:vm.

**Источники истины:** spec `docs/superpowers/specs/2026-06-22-exam-iframe-wrapper-design.md`; эталоны в `c:\Users\eleru\Downloads\Telegram Desktop\Cambridge 21 *.html`.

---

## File Structure

**Создать:**
- `migrations/0016_runner_html/{up,down}.sql` — колонка `content_item.runner_html`
- `src/lib/import/runner/fixtures/listening.html`, `reading.html` — копии эталонов для тестов
- `src/lib/import/runner/parse-runner.ts` — извлечение ключей/band/qtype/section/audio из Cambridge-файла → `ParsedTest`
- `src/lib/import/runner/parse-runner.test.ts`
- `src/lib/import/runner/sanitize-runner.ts` — очистка файла → runner_html (вырез ключей, audio, STORAGE_KEY, html2pdf, мост)
- `src/lib/import/runner/sanitize-runner.test.ts`
- `src/lib/import/runner/bridge.ts` — JS-строки моста reading/listening
- `src/lib/import/runner/import-runner.ts` — orchestrator (parse → persist → audio → sanitize → update)
- `src/lib/supabase/service.ts` — service-role client helper (вынести из telegram/storage)
- `app/app/exam/[id]/page.tsx` — exam-страница обёртки
- `app/app/exam/[id]/ExamFrame.tsx` — client: iframe + postMessage → submitAttempt
- `app/app/exam/[id]/runner/route.ts` — отдаёт runner_html (auth+tier)

**Модифицировать:**
- `src/db/schema.ts` — `+runnerHtml` в `contentItem`
- `src/lib/import/persist.ts` — `+runnerHtml?` в opts
- `src/lib/telegram/storage.ts` — переиспользовать `src/lib/supabase/service.ts`
- `app/admin/actions.ts` — `uploadTest` → `importRunner`
- `scripts/import-file.ts` — → `importRunner`

**Не трогаем:** `grade.ts`, `submitAttempt`/`ensureAttempt` (переиспользуем), result page (bando), старые parse-* (legacy, чистим позже — §10 spec).

---

## Phase A — Схема и persist

### Task 1: Колонка `content_item.runner_html`

**Files:**
- Create: `migrations/0016_runner_html/up.sql`
- Create: `migrations/0016_runner_html/down.sql`
- Modify: `src/db/schema.ts:192-225` (таблица `contentItem`)
- Modify: `src/lib/import/persist.ts:39-84`

- [ ] **Step 1: Написать миграцию**

`migrations/0016_runner_html/up.sql`:
```sql
-- Sanitized full HTML of the interactive exam runner (real Cambridge file with
-- answer keys stripped, audio rehosted, submit-bridge injected). NULL = legacy
-- test imported before the iframe-wrapper track (served by the old runner).
ALTER TABLE content_item ADD COLUMN runner_html text;
```

`migrations/0016_runner_html/down.sql`:
```sql
ALTER TABLE content_item DROP COLUMN runner_html;
```

- [ ] **Step 2: Применить миграцию на local docker**

Run: `npm run docker:db && npm run db:migrate`
Expected: `applied 0016_runner_html` (или «up to date» при повторе).

- [ ] **Step 3: Зеркалить в schema.ts**

В `src/db/schema.ts` в объект `contentItem` после `bandScale: jsonb("band_scale"),` (строка 207) добавить:
```typescript
    // Sanitized interactive runner HTML (iframe-wrapper track). NULL = legacy.
    runnerHtml: text("runner_html"),
```

- [ ] **Step 4: Добавить runnerHtml в persistTest**

В `src/lib/import/persist.ts` расширить тип opts (строка 39-42):
```typescript
export async function persistTest(
  parsed: ParsedTest,
  opts: { sourceFilePath?: string; createdBy?: string; runnerHtml?: string } = {},
): Promise<string> {
```
В INSERT `contentItem` (строка 69-84) добавить поле:
```typescript
    runnerHtml: opts.runnerHtml ?? null,
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 6: Commit + push**

```bash
git add migrations/0016_runner_html src/db/schema.ts src/lib/import/persist.ts
git commit -m "feat(exam): runner_html column + persist support"
git push
```

> **※ heads-up:** миграция тронула content_item. Применить 0016 к Supabase сразу за пушем (окно Vercel↔Supabase).

---

## Phase B — Парсер ключей нового формата

### Task 2: `parse-runner.ts` — извлечение answer_key/band/qtype/section/audio

Cambridge-файлы кладут ключи как чистые литералы верхнего уровня `<script>`:
listening — `const KEY={...}`, `function band(r){...}`; reading — `const correctAnswers={...}`,
`const acceptableAnswers={...}`, `const questionTypes={...}`, `const evidence={...}`,
`const explanations={...}`, `function getBandFor40(s){...}`. Детектор типа — те же маркеры,
что у `parseTest`. Разметку вопросов НЕ парсим (рендерит файл) — строим лёгкий `ParsedTest`
с одним passage-контейнером и `question`+`answer_key` по номерам.

**Files:**
- Create: `src/lib/import/runner/fixtures/listening.html` (копия эталона)
- Create: `src/lib/import/runner/fixtures/reading.html` (копия эталона)
- Create: `src/lib/import/runner/parse-runner.ts`
- Test: `src/lib/import/runner/parse-runner.test.ts`

- [ ] **Step 1: Скопировать эталоны в fixtures**

```bash
mkdir -p src/lib/import/runner/fixtures
cp "/c/Users/eleru/Downloads/Telegram Desktop/Cambridge 21 Listening Test 1.html" src/lib/import/runner/fixtures/listening.html
cp "/c/Users/eleru/Downloads/Telegram Desktop/Cambridge 21 Test 1 - Full Reading Test.html" src/lib/import/runner/fixtures/reading.html
```

- [ ] **Step 2: Написать падающий тест**

`src/lib/import/runner/parse-runner.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRunner } from "./parse-runner";

const FIX = join(__dirname, "fixtures");
const reading = readFileSync(join(FIX, "reading.html"), "utf8");
const listening = readFileSync(join(FIX, "listening.html"), "utf8");

describe("parseRunner — reading", () => {
  const r = parseRunner(reading);
  it("определяет section reading и 40 вопросов", () => {
    expect(r.parsed.section).toBe("reading");
    expect(r.parsed.questions).toHaveLength(40);
  });
  it("берёт acceptableAnswers как text_accept, иначе correctAnswers как exact", () => {
    const q4 = r.parsed.questions.find((q) => q.number === 4)!; // journals/journal
    expect(q4.answer.mode).toBe("text_accept");
    expect(q4.answer.accept).toContain("journal");
    const q8 = r.parsed.questions.find((q) => q.number === 8)!; // TRUE
    expect(q8.answer.mode).toBe("exact");
    expect(q8.answer.accept).toEqual(["TRUE"]);
  });
  it("маппит qtype из questionTypes", () => {
    const q8 = r.parsed.questions.find((q) => q.number === 8)!;
    expect(q8.qtype).toBe("tfng");
  });
  it("строит bandScale из getBandFor40 (40->9)", () => {
    expect(r.parsed.bandScale?.["40"]).toBe(9);
  });
  it("кладёт explanation и evidence в answer_key", () => {
    const q1 = r.parsed.questions.find((q) => q.number === 1)!;
    expect(q1.answer.explanation).toMatch(/mining/i);
    expect(q1.answer.evidence?.snippet).toMatch(/shipping and mining/i);
  });
});

describe("parseRunner — listening", () => {
  const r = parseRunner(listening);
  it("определяет section listening и внешний audio src", () => {
    expect(r.parsed.section).toBe("listening");
    expect(r.externalAudioSrc).toMatch(/^https?:\/\/.+\.mp3$/);
  });
  it("KEY с >1 вариантом → text_accept, иначе exact", () => {
    const q1 = r.parsed.questions.find((q) => q.number === 1)!; // ["10","ten"]
    expect(q1.answer.mode).toBe("text_accept");
    expect(q1.answer.accept).toEqual(["10", "ten"]);
  });
  it("строит bandScale из band()", () => {
    expect(r.parsed.bandScale?.["40"]).toBe(9);
  });
});
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `npx vitest run src/lib/import/runner/parse-runner.test.ts`
Expected: FAIL — «parseRunner is not a function».

- [ ] **Step 4: Реализовать parse-runner.ts**

`src/lib/import/runner/parse-runner.ts`:
```typescript
import * as cheerio from "cheerio";
import { extractData, extractFunctionTable } from "../extract-js";
import { canonQuestionType } from "../question-types";
import type { ParsedTest, ParsedQuestion, ParsedAnswerKey } from "../types";

export interface RunnerParseResult {
  parsed: ParsedTest;
  /** Внешний <audio src> (listening) — будет перезалит в Storage. null для reading. */
  externalAudioSrc: string | null;
}

const NORM = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

function scriptText(html: string): string {
  // Конкатенация всех inline <script> (ключи лежат в одном из них).
  const $ = cheerio.load(html);
  return $("script:not([src])").map((_, el) => $(el).html() ?? "").get().join("\n");
}

function detectSection(html: string): "listening" | "reading" {
  const $ = cheerio.load(html);
  return $("audio").length > 0 ? "listening" : "reading";
}

export function parseRunner(html: string): RunnerParseResult {
  const section = detectSection(html);
  return section === "listening" ? parseListeningRunner(html) : parseReadingRunner(html);
}

function mkQuestion(number: number, qtype: string, answer: ParsedAnswerKey): ParsedQuestion {
  return {
    number,
    passageOrder: 1,
    qtype,
    promptHtml: "",
    options: null,
    groupKey: null,
    evidenceRef: null,
    answer,
  };
}

function parseReadingRunner(html: string): RunnerParseResult {
  const src = scriptText(html);
  const correct = extractData<Record<string, string>>(src, "correctAnswers") ?? {};
  const accept = extractData<Record<string, string[]>>(src, "acceptableAnswers") ?? {};
  const types = extractData<Record<string, string>>(src, "questionTypes") ?? {};
  const expl = extractData<Record<string, string>>(src, "explanations") ?? {};
  const evid = extractData<Record<string, { para: string; snippet: string }>>(src, "evidence") ?? {};
  const bandScale = extractFunctionTable(src, "getBandFor40", 0, 40);

  const numbers = Object.keys(correct).map(Number).sort((a, b) => a - b);
  const questions = numbers.map((n) => {
    const k = String(n);
    const answer: ParsedAnswerKey = accept[k]?.length
      ? { mode: "text_accept", accept: accept[k], explanation: expl[k] ?? null, evidence: evid[k] ?? null }
      : { mode: "exact", accept: [NORM(correct[k])], explanation: expl[k] ?? null, evidence: evid[k] ?? null };
    const qtype = canonQuestionType(types[k] ?? "").type ?? "short_answer";
    return mkQuestion(n, qtype, answer);
  });

  const parsed: ParsedTest = {
    title: extractTitle(html, "Reading"),
    section: "reading",
    category: "full_reading",
    bandType: "reading_academic",
    durationSeconds: 60 * 60,
    questionTypes: [...new Set(questions.map((q) => q.qtype))],
    bandScale: bandScale ? toStringKeys(bandScale) : null,
    passages: [{ order: 1, title: null, bodyHtml: "", audioPath: null, questionsHtml: null }],
    questions,
    warnings: [],
  };
  return { parsed, externalAudioSrc: null };
}

function parseListeningRunner(html: string): RunnerParseResult {
  const src = scriptText(html);
  const key = extractData<Record<string, string[]>>(src, "KEY") ?? {};
  const types = extractData<Record<string, string>>(src, "QTYPE") ?? {};
  const bandScale = extractFunctionTable(src, "band", 0, 40);

  const numbers = Object.keys(key).map(Number).sort((a, b) => a - b);
  const questions = numbers.map((n) => {
    const variants = key[String(n)] ?? [];
    const answer: ParsedAnswerKey = {
      mode: variants.length > 1 ? "text_accept" : "exact",
      accept: variants,
      explanation: null,
      evidence: null,
    };
    const qtype = canonQuestionType(types[String(n)] ?? "").type ?? "short_answer";
    return mkQuestion(n, qtype, answer);
  });

  const $ = cheerio.load(html);
  const externalAudioSrc = $("audio").attr("src") ?? null;

  const parsed: ParsedTest = {
    title: extractTitle(html, "Listening"),
    section: "listening",
    category: "full_listening",
    bandType: "listening",
    durationSeconds: 30 * 60,
    questionTypes: [...new Set(questions.map((q) => q.qtype))],
    bandScale: bandScale ? toStringKeys(bandScale) : null,
    passages: [{ order: 1, title: null, bodyHtml: "", audioPath: null, questionsHtml: null }],
    questions,
    warnings: [],
  };
  return { parsed, externalAudioSrc };
}

function extractTitle(html: string, fallback: string): string {
  const $ = cheerio.load(html);
  return ($("title").text().trim() || fallback).slice(0, 200);
}

function toStringKeys(t: Record<number, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(t)) out[String(k)] = v;
  return out;
}
```

- [ ] **Step 5: Запустить — убедиться, что проходит**

Run: `npx vitest run src/lib/import/runner/parse-runner.test.ts`
Expected: PASS (все describe). Если qtype листенинга не извлёкся (нет `QTYPE`-объекта в данных) — тест на qtype листенинга не включён, fallback `short_answer` допустим; reading qtype проверяется.

- [ ] **Step 6: Typecheck + commit + push**

```bash
npx tsc --noEmit
git add src/lib/import/runner/parse-runner.ts src/lib/import/runner/parse-runner.test.ts src/lib/import/runner/fixtures
git commit -m "feat(exam): runner key parser (cambridge format)"
git push
```

---

## Phase C — Очистка файла и мост

### Task 3: `sanitize-runner.ts` — вырез ключей, audio, STORAGE_KEY, html2pdf

**Files:**
- Create: `src/lib/import/runner/sanitize-runner.ts`
- Test: `src/lib/import/runner/sanitize-runner.test.ts`

- [ ] **Step 1: Написать падающий тест (главный — анти-утечка)**

`src/lib/import/runner/sanitize-runner.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRunner } from "./parse-runner";
import { sanitizeRunner, assertNoKeyLeak } from "./sanitize-runner";

const FIX = join(__dirname, "fixtures");
const reading = readFileSync(join(FIX, "reading.html"), "utf8");
const listening = readFileSync(join(FIX, "listening.html"), "utf8");

describe("sanitizeRunner — reading", () => {
  const r = parseRunner(reading);
  const out = sanitizeRunner(reading, { contentItemId: "cid-1", section: "reading" });
  it("вырезает объявления ключей в пустышку", () => {
    expect(out).toMatch(/const correctAnswers\s*=\s*\{\}/);
    expect(out).toMatch(/const acceptableAnswers\s*=\s*\{\}/);
  });
  it("ни один ответ из answer_key не встречается в выходе (анти-утечка)", () => {
    expect(() => assertNoKeyLeak(out, r.parsed)).not.toThrow();
  });
  it("уникализирует STORAGE_KEY под contentItemId", () => {
    expect(out).toContain("cid-1");
    expect(out).not.toMatch(/ielts_cdi_camb21_test1_full_v1['"]/);
  });
  it("удаляет внешний html2pdf <script>", () => {
    expect(out).not.toMatch(/html2pdf/);
  });
  it("инжектит мост reading (override showResults)", () => {
    expect(out).toContain("ielts-submit");
    expect(out).toMatch(/showResults\s*=/);
  });
});

describe("sanitizeRunner — listening", () => {
  const out = sanitizeRunner(listening, {
    contentItemId: "cid-2",
    section: "listening",
    audioUrl: "https://store.example/audio/cid-2.mp3",
  });
  it("подменяет <audio src> на наш URL", () => {
    expect(out).toContain("https://store.example/audio/cid-2.mp3");
    expect(out).not.toContain("archive.org");
  });
  it("инжектит мост listening (override doSubmit.onclick)", () => {
    expect(out).toContain("ielts-submit");
    expect(out).toMatch(/getElementById\(['"]doSubmit['"]\)\.onclick/);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/lib/import/runner/sanitize-runner.test.ts`
Expected: FAIL — «sanitizeRunner is not a function».

- [ ] **Step 3: Реализовать sanitize-runner.ts**

`src/lib/import/runner/sanitize-runner.ts`:
```typescript
import { extractObjectLiteral } from "../extract-js";
import { READING_BRIDGE, LISTENING_BRIDGE } from "./bridge";
import type { ParsedTest } from "../types";

export interface SanitizeOpts {
  contentItemId: string;
  section: "reading" | "listening";
  /** Наш Storage URL для перезалитого аудио (listening). */
  audioUrl?: string;
}

const READING_KEYS = ["correctAnswers", "acceptableAnswers", "explanations", "evidence", "questionTypes"];
const LISTENING_KEYS = ["KEY", "QTYPE"];

/** Заменяет `const NAME = {...}` на `const NAME = {}` (балансировка из extract-js). */
function blankObject(src: string, name: string): string {
  const literal = extractObjectLiteral(src, name);
  if (literal == null) return src;
  return src.replace(literal, "{}");
}

/** Заменяет тело `function NAME(...){...}` на заглушку `return 0`. */
function blankFunction(src: string, name: string): string {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) return src;
  let i = m.index + m[0].length, depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  return src.slice(0, m.index) + `function ${name}(){return 0;}` + src.slice(i);
}

export function sanitizeRunner(html: string, opts: SanitizeOpts): string {
  let out = html;

  // 1. Вырезать ключи + band-функции
  const keys = opts.section === "reading" ? READING_KEYS : LISTENING_KEYS;
  for (const name of keys) out = blankObject(out, name);
  for (const fn of ["band", "getBand", "getBandFor40"]) out = blankFunction(out, fn);

  // 2. Подменить audio src (listening)
  if (opts.section === "listening" && opts.audioUrl) {
    out = out.replace(/(<audio[^>]*\ssrc=)(["'])[^"']*\2/i, `$1$2${opts.audioUrl}$2`);
  }

  // 3. Уникализировать STORAGE_KEY (+ HIGHLIGHT_STORAGE_KEY если есть)
  out = out.replace(
    /((?:const|let|var)\s+(?:STORAGE_KEY|HIGHLIGHT_STORAGE_KEY)\s*=\s*)(["'])([^"']*)\2/g,
    (_m, decl, q, val) => `${decl}${q}${val}__${opts.contentItemId}${q}`,
  );

  // 4. Удалить внешний html2pdf <script src>
  out = out.replace(/<script[^>]*html2pdf[^>]*>\s*<\/script>/gi, "");

  // 5. Инжектить мост перед </body>
  const bridge = opts.section === "reading" ? READING_BRIDGE : LISTENING_BRIDGE;
  out = out.replace(/<\/body>/i, `${bridge}\n</body>`);

  return out;
}

/** Гейт анти-утечки: ни один accept-вариант не встречается в выходном HTML. */
export function assertNoKeyLeak(out: string, parsed: ParsedTest): void {
  const hay = out.toLowerCase();
  for (const q of parsed.questions) {
    for (const a of q.answer.accept) {
      const needle = String(a).trim().toLowerCase();
      // Пропускаем тривиальные значения (буквы/короткие), которые легитимно есть в разметке опций.
      if (needle.length < 3) continue;
      if (hay.includes(needle)) {
        throw new Error(`Key leak: answer "${a}" (q${q.number}) found in runner_html`);
      }
    }
  }
}
```

> Примечание по анти-утечке: короткие ответы (буквы MCQ "A"/"B", числа) легитимно
> присутствуют в разметке вариантов — для них утечки нет (студент и так видит варианты).
> Гейт ловит текстовые ответы completion (≥3 символов), которые НЕ должны быть в коде.

- [ ] **Step 4: Запустить sanitize-тест без моста (bridge заглушим в Task 4)**

Временная заглушка, чтобы тест компилировался: создать `src/lib/import/runner/bridge.ts` со строками-заглушками `export const READING_BRIDGE = ""; export const LISTENING_BRIDGE = "";` — будет заменён в Task 4. Запустить:
Run: `npx vitest run src/lib/import/runner/sanitize-runner.test.ts`
Expected: PASS для вырезания/audio/storage-key/html2pdf/анти-утечки; тесты «инжектит мост» — PASS после Task 4.

- [ ] **Step 5: Commit (без push — мост в следующей задаче)**

```bash
git add src/lib/import/runner/sanitize-runner.ts src/lib/import/runner/sanitize-runner.test.ts src/lib/import/runner/bridge.ts
git commit -m "feat(exam): runner sanitizer (strip keys, audio, storage-key, html2pdf)"
```

### Task 4: `bridge.ts` — мост reading/listening

Мост — внешний `<script>`, собирает ответы из DOM по селекторам шаблона и шлёт parent.
Reading: override `window.showResults` (+ `window.markOnPage` no-op). Listening: override
`document.getElementById('doSubmit').onclick`. Оба пути сабмита (кнопка + авто-таймер)
проходят через эти точки (проверено на эталонах).

**Files:**
- Modify: `src/lib/import/runner/bridge.ts` (заменить заглушки реальным кодом)

- [ ] **Step 1: Реализовать bridge.ts**

`src/lib/import/runner/bridge.ts`:
```typescript
// Мост: собирает ответы из DOM и шлёт parent. Внешний <script>, не зависит от их scope.

const READING_COLLECT = `
function __collect(){
  var a = {};
  for (var q = 1; q <= 40; q++){
    var sel = document.querySelector('.dd-blank[data-q="'+q+'"] .drag-token[data-value]');
    if (sel){ a[q] = sel.getAttribute('data-value'); continue; }
    var radio = document.querySelector('input[name="q'+q+'"]:checked');
    if (radio){ a[q] = radio.value; continue; }
    var txt = document.querySelector('input.inspera-input-text[name="q'+q+'"]');
    if (txt){ a[q] = txt.value.trim(); continue; }
    a[q] = '';
  }
  return a;
}`;

const LISTENING_COLLECT = `
function __collect(){
  var a = {};
  for (var q = 1; q <= 40; q++){
    var dz = document.querySelector('.dropzone[data-q="'+q+'"][data-value]');
    if (dz){ a[q] = dz.getAttribute('data-value'); continue; }
    var checks = document.querySelectorAll('.mcq input[type="checkbox"][data-q="'+q+'"]:checked, .mcq.multi[data-qs*="'+q+'"] input[type="checkbox"]:checked');
    if (checks.length){ a[q] = Array.prototype.map.call(checks, function(c){return c.value;}); continue; }
    var radio = document.querySelector('input[name="q'+q+'"]:checked');
    if (radio){ a[q] = radio.value; continue; }
    var gap = document.querySelector('input.gap[data-q="'+q+'"]');
    if (gap){ a[q] = gap.value.trim(); continue; }
    a[q] = '';
  }
  return a;
}`;

function send() {
  return `try{ parent.postMessage({ type: 'ielts-submit', answers: __collect() }, '*'); }catch(e){}`;
}

export const READING_BRIDGE = `<script>(function(){${READING_COLLECT}
  if (typeof window.showResults !== 'undefined') {
    window.markOnPage = function(){};
    window.showResults = function(){ ${send()} };
  }
})();</script>`;

export const LISTENING_BRIDGE = `<script>(function(){${LISTENING_COLLECT}
  function hook(){
    var btn = document.getElementById('doSubmit');
    if (!btn){ return setTimeout(hook, 200); }
    btn.onclick = function(){ ${send()} };
  }
  hook();
})();</script>`;
```

> ⚠️ Селекторы listening-multi (`.mcq.multi[data-qs]`) и порядок проверок зафиксированы по
> анализу эталона; точные классы свериться при ручной браузерной проверке (Task 9). Если
> формат собранного multi-ответа отличается — поправить здесь, грейдинг (`mcq_set`) не трогать.

- [ ] **Step 2: Запустить sanitize-тест (теперь мост реальный)**

Run: `npx vitest run src/lib/import/runner/sanitize-runner.test.ts`
Expected: PASS все, включая «инжектит мост reading/listening».

- [ ] **Step 3: Typecheck + commit + push**

```bash
npx tsc --noEmit
git add src/lib/import/runner/bridge.ts
git commit -m "feat(exam): submit bridge (dom-collect + postMessage)"
git push
```

---

## Phase D — Orchestrator и wiring импорта

### Task 5: `import-runner.ts` + service client + admin/CLI wiring

**Files:**
- Create: `src/lib/supabase/service.ts`
- Modify: `src/lib/telegram/storage.ts` (использовать service.ts)
- Create: `src/lib/import/runner/import-runner.ts`
- Modify: `app/admin/actions.ts:22-55`
- Modify: `scripts/import-file.ts`

- [ ] **Step 1: Вынести service-role client**

`src/lib/supabase/service.ts`:
```typescript
import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";

/** Service-role Supabase client (bypasses RLS). Server-only — для Storage/owner-операций. */
export function createServiceClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
```
В `src/lib/telegram/storage.ts` заменить локальное создание клиента (строки 22-26) на `const supabase = createServiceClient();` с импортом `import { createServiceClient } from "@/lib/supabase/service";`.

- [ ] **Step 2: Реализовать import-runner.ts**

`src/lib/import/runner/import-runner.ts`:
```typescript
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { contentItem, passage } from "@/db/schema";
import { parseRunner } from "./parse-runner";
import { sanitizeRunner, assertNoKeyLeak } from "./sanitize-runner";
import { persistTest } from "../persist";
import { createServiceClient } from "@/lib/supabase/service";

const AUDIO_BUCKET = "audio";

/** Полный импорт обёртки: parse → persist → (audio) → sanitize → runner_html. */
export async function importRunner(
  html: string,
  opts: { sourceFilePath?: string; createdBy?: string },
): Promise<string> {
  const { parsed, externalAudioSrc } = parseRunner(html);

  // 1. Persist ключи/метаданные (получаем id)
  const contentItemId = await persistTest(parsed, opts);

  // 2. Аудио (listening): скачать внешний mp3 → наш Storage → подменить src
  let audioUrl: string | undefined;
  if (parsed.section === "listening" && externalAudioSrc) {
    const res = await fetch(externalAudioSrc);
    if (!res.ok) throw new Error(`Audio fetch failed: ${res.status} ${externalAudioSrc}`);
    const bytes = await res.arrayBuffer();
    const supabase = createServiceClient();
    const path = `${contentItemId}.mp3`;
    const up = await supabase.storage.from(AUDIO_BUCKET).upload(path, bytes, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (up.error) throw up.error;
    audioUrl = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(path).data.publicUrl;
    await db.update(passage).set({ audioPath: audioUrl })
      .where(and(eq(passage.contentItemId, contentItemId), eq(passage.order, 1)));
  }

  // 3. Очистить файл и проверить анти-утечку
  const runnerHtml = sanitizeRunner(html, { contentItemId, section: parsed.section, audioUrl });
  assertNoKeyLeak(runnerHtml, parsed);

  // 4. Сохранить runner_html
  await db.update(contentItem).set({ runnerHtml }).where(eq(contentItem.id, contentItemId));

  return contentItemId;
}
```

- [ ] **Step 3: Переключить admin uploadTest**

В `app/admin/actions.ts` (строки 22-42) заменить `parseTest`+`persistTest` на:
```typescript
import { importRunner } from "@/lib/import/runner/import-runner";
// ...
const html = await file.text();
await importRunner(html, { sourceFilePath: file.name, createdBy: profile.id });
```
(оставить `revalidateTag("content_item")` после).

- [ ] **Step 4: Переключить CLI**

В `scripts/import-file.ts` заменить динамический импорт на:
```typescript
const { importRunner } = await import("../src/lib/import/runner/import-runner.ts");
const id = await importRunner(readFileSync(resolve(path), "utf8"), { sourceFilePath: path });
```

- [ ] **Step 5: Probe на local docker (реальный импорт)**

Скрипт `scripts/_probe-import-runner.ts` (throwaway):
```typescript
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
config({ path: join(HERE, "..", ".env.local") });
const { importRunner } = await import("../src/lib/import/runner/import-runner.ts");
const { db } = await import("../src/db/index.ts");
const { contentItem } = await import("../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const html = readFileSync(join(HERE, "..", "src/lib/import/runner/fixtures/reading.html"), "utf8");
const id = await importRunner(html, { sourceFilePath: "_probe_reading.html" });
const [row] = await db.select({ rh: contentItem.runnerHtml }).from(contentItem).where(eq(contentItem.id, id));
console.log(id ? "[OK] imported, runner_html length=" + (row?.rh?.length ?? 0) : "[FAIL]");
process.exit(row?.rh ? 0 : 1);
```
Run (DATABASE_URL должен указывать на local docker для безопасности):
`npm run docker:db && npm run db:migrate && npx tsx scripts/_probe-import-runner.ts`
Expected: `[OK] imported, runner_html length=…` (>100000). Затем `rm scripts/_probe-import-runner.ts`.

- [ ] **Step 6: Typecheck + commit + push**

```bash
npx tsc --noEmit
git add src/lib/supabase/service.ts src/lib/telegram/storage.ts src/lib/import/runner/import-runner.ts app/admin/actions.ts scripts/import-file.ts
git commit -m "feat(exam): runner import orchestrator + admin/cli wiring"
git push
```

---

## Phase E — Runtime (route + frame)

### Task 6: Route `/app/exam/[id]/runner` — отдаёт runner_html

**Files:**
- Create: `app/app/exam/[id]/runner/route.ts`

- [ ] **Step 1: Реализовать route handler**

`app/app/exam/[id]/runner/route.ts`:
```typescript
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contentItem } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import { gateAccess } from "../../../reading/[id]/actions";

// Отдаёт очищенный runner_html в iframe. Auth — через middleware (/app защищён);
// доступ по tier — gateAccess. Контент платный → НЕ публичный Storage.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // tier/daily-limit гейт (reuse). Бросает redirect/Error при отказе — ловим.
  try {
    await gateAccess(user.id, id);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const [row] = await db
    .select({ html: contentItem.runnerHtml })
    .from(contentItem)
    .where(eq(contentItem.id, id));
  if (!row?.html) return new Response("Not found", { status: 404 });

  return new Response(row.html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // CSP: разрешить инлайн-скрипты файла, аудио из Storage; блокировать навигацию.
      "Content-Security-Policy":
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; media-src https: blob:; frame-ancestors 'self'",
      "X-Frame-Options": "SAMEORIGIN",
      "Cache-Control": "private, no-store",
    },
  });
}
```

> Проверить экспорт `gateAccess` из `app/app/reading/[id]/actions.ts`. Если он не
> экспортирован — экспортировать (он уже вызывается в `ensureAttempt`/`submitAttempt`).
> Если `gateAccess` делает `redirect()` (несовместимо с route) — заменить на проверку
> через `effectiveTier`/`hasFullReview` инлайн в route (импорт из `@/lib/tiers`).

- [ ] **Step 2: Проверить экспорт gateAccess**

Run: `grep -n "function gateAccess" app/app/reading/[id]/actions.ts`
Если `export` отсутствует — добавить `export`. Убедиться, что он возвращает/бросает, а не `redirect()` (для route нужен throw/boolean; при необходимости сделать вариант `assertAccess` без redirect).

- [ ] **Step 3: Typecheck + commit + push**

```bash
npx tsc --noEmit
git add "app/app/exam/[id]/runner/route.ts" "app/app/reading/[id]/actions.ts"
git commit -m "feat(exam): authorized runner_html route"
git push
```

### Task 7: `ExamFrame.tsx` + exam page — iframe + postMessage → submit

**Files:**
- Create: `app/app/exam/[id]/ExamFrame.tsx`
- Create: `app/app/exam/[id]/page.tsx`

- [ ] **Step 1: Реализовать ExamFrame (client)**

`app/app/exam/[id]/ExamFrame.tsx`:
```typescript
"use client";
import { useEffect, useRef, useTransition } from "react";
import { submitAttempt } from "../../reading/[id]/actions";

interface Props {
  attemptId: string;
  contentItemId: string;
}

export default function ExamFrame({ attemptId, contentItemId }: Props) {
  const submitted = useRef(false);
  const [, start] = useTransition();

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Принимаем только наш origin (iframe same-origin).
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; answers?: Record<string, string | string[]> };
      if (data?.type !== "ielts-submit" || submitted.current) return;
      submitted.current = true;
      start(() => submitAttempt(attemptId, data.answers ?? {}));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [attemptId]);

  return (
    <iframe
      src={`/app/exam/${contentItemId}/runner`}
      title="IELTS exam"
      sandbox="allow-scripts allow-same-origin allow-modals"
      style={{ width: "100%", height: "100vh", border: "0", display: "block" }}
    />
  );
}
```

- [ ] **Step 2: Реализовать exam page (server)**

`app/app/exam/[id]/page.tsx`:
```typescript
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contentItem } from "@/db/schema";
import { ensureAttempt } from "../../reading/[id]/actions";
import ExamFrame from "./ExamFrame";

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [test] = await db
    .select({ id: contentItem.id, runnerHtml: contentItem.runnerHtml })
    .from(contentItem)
    .where(eq(contentItem.id, id));
  if (!test?.runnerHtml) notFound();

  // Старт/resume attempt (server-stamped, tier+daily-limit гейт внутри).
  const { attemptId } = await ensureAttempt(id);

  return <ExamFrame attemptId={attemptId} contentItemId={id} />;
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: без ошибок.
(Полный `npm run build` — только если dev не запущен; см. CLAUDE.md gotcha.)

- [ ] **Step 4: Commit + push**

```bash
git add "app/app/exam/[id]/ExamFrame.tsx" "app/app/exam/[id]/page.tsx"
git commit -m "feat(exam): iframe exam page + submit bridge listener"
git push
```

---

## Phase F — Каталог-ссылка и финальная проверка

### Task 8: Направить каталог на новый exam-роут

**Files:**
- Modify: каталог-компонент (ссылка «начать тест»)

- [ ] **Step 1: Найти текущую ссылку на экзамен**

Run: `grep -rn "/app/reading/" app/app --include=*.tsx | grep -i "href\|Link"`
Найти, где каталог ведёт на `/app/reading/${id}`.

- [ ] **Step 2: Переключить на `/app/exam/${id}` для тестов с runner_html**

В каталог-запросе добавить выборку `runner_html != null` (или поле-флаг) и для таких тестов
вести на `/app/exam/${id}`; legacy (runner_html == null) — на старый `/app/reading/${id}`.
Точное место — по результату Step 1; показать diff в реализации.

- [ ] **Step 3: Typecheck + commit + push**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(exam): route catalog to iframe runner for new tests"
git push
```

### Task 9: E2E на реальном Cambridge-файле (браузер)

- [ ] **Step 1: Залить оба эталона в local docker**

Run:
```bash
npx tsx scripts/import-file.ts "src/lib/import/runner/fixtures/reading.html"
npx tsx scripts/import-file.ts "src/lib/import/runner/fixtures/listening.html"
```
В БД (local) выставить `status='published'` обоим (через admin UI или `db:status`-проба).

- [ ] **Step 2: Браузерная проверка reading (правило ui-verify-live-browser)**

Поднять `npm run dev`, открыть `/app/exam/<reading-id>`:
- вид и процесс совпадают с файлом (split, divider-resize, Practice/Mock, табы пассажей, highlight);
- F12 → в Sources нет `correctAnswers`/`acceptableAnswers` со значениями (пустышки `{}`);
- заполнить ответы, нажать Deliver → confirm → редирект на bando-result;
- result показывает raw/band/breakdown, проверить корректность по нескольким вопросам.

- [ ] **Step 3: Браузерная проверка listening**

Открыть `/app/exam/<listening-id>`:
- аудио играет с нашего Storage URL (не archive.org), single-pass, transfer-phase;
- drag-drop, темы, размеры работают;
- авто-сабмит по таймеру И ручной Submit → оба ведут на bando-result;
- ключей в коде нет.

- [ ] **Step 4: Зафиксировать результат**

Если расхождения в сборе ответов (multi/drag) — поправить селекторы в `bridge.ts` (Task 4),
перезалить, повторить. Коммит правок:
```bash
git add -A && git commit -m "fix(exam): bridge selectors verified in browser" && git push
```

---

## Self-Review (выполнено при написании)

- **Spec coverage:** §3 архитектура → Task 6/7; §4 импорт → Task 2/3/4/5; §5 runtime → Task 6/7/8;
  §6 мост → Task 4; §7 схема → Task 1; §9 риск утечки → `assertNoKeyLeak` (Task 3/5);
  STORAGE_KEY/html2pdf/allow-modals → Task 3/7. ✓
- **Placeholders:** код показан для всех модулей; точки «свериться в браузере» (bridge-селекторы,
  gateAccess-экспорт) — явные verify-шаги, не TODO. ✓
- **Type consistency:** `RunnerParseResult.{parsed,externalAudioSrc}`, `SanitizeOpts.{contentItemId,
  section,audioUrl}`, `importRunner(html, opts)`, `READING_BRIDGE/LISTENING_BRIDGE`, `assertNoKeyLeak(out,
  parsed)` — согласованы между задачами. ✓

## Открытые точки для проверки при исполнении

1. `gateAccess` экспорт/совместимость с route (Task 6 Step 2) — может потребовать `assertAccess`-вариант без `redirect()`.
2. Наличие `QTYPE`-объекта в listening-данных (Task 2) — если нет, qtype листенинга = fallback; perType-разбивка листенинга будет грубее (не блокер).
3. Точные селекторы сбора multi/drag в `bridge.ts` (Task 4/9) — финально подтверждаются в браузере.
