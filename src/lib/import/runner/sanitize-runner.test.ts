import { describe, it, expect, beforeAll } from "vitest";
import * as cheerio from "cheerio";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRunner } from "./parse-runner";
import { sanitizeRunner, assertNoKeyLeak, stripAnalysisLeak } from "./sanitize-runner";
import { polyfillRunnerStorage } from "./runner-storage";
import { skinRunnerGate, skinRunnerBrand } from "./skin-runner";

const FIX = join(__dirname, "fixtures");
const reading = readFileSync(join(FIX, "reading.html"), "utf8");
const listening = readFileSync(join(FIX, "listening.html"), "utf8");

describe("sanitizeRunner — reading", () => {
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(reading);
  });
  const out = sanitizeRunner(reading, { contentItemId: "cid-1", section: "reading" });
  it("вырезает объявления ключей в пустышку", () => {
    expect(out).toMatch(/const correctAnswers\s*=\s*\{\}/);
    expect(out).toMatch(/const acceptableAnswers\s*=\s*\{\}/);
  });
  it("ни один ответ из answer_key не встречается в выходе (анти-утечка)", () => {
    expect(() => assertNoKeyLeak(out, r.parsed)).not.toThrow();
  });
  it("анти-утечка ловит ключи в СЫРОМ файле (гейт не пустышка)", () => {
    expect(() => assertNoKeyLeak(reading, r.parsed)).toThrow(/key leak/i);
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

  // DOM-утечка: reading-раннер несёт per-question разборы `[data-analysis]` с ответом
  // в тексте (напр. MCQ Q27 → «(<strong>B</strong>)»), скрытые лишь CSS. Санитайзер
  // обязан вырезать их из DOM (assertNoKeyLeak сканирует только <script>).
  it("вырезает reading `[data-analysis]` разборы из DOM (ответ не уезжает)", () => {
    expect(out).not.toMatch(/class="analysis"/);
    expect(out).not.toContain('beet sugar "has been massively'); // текст разбора Q27
    // JS-селектор `.analysis[data-analysis]` в скрипте раннера — не элемент, остаётся
    // (безвреден: querySelector вернёт null), но самих reveal-элементов в DOM нет.
    const bodyDivs = out.match(/<div[^>]*\sdata-analysis=/g);
    expect(bodyDivs).toBeNull();
  });
});

// N1 (AUDIT_2026-07-02): mcq-буквы короче 3 символов проскакивали бэкстоп, а
// mcqGroups (несёт correct-набор) вообще не вырезался; ключ под нераспознанным
// именем объекта оставался в published runner_html молча.
describe("assertNoKeyLeak — N1 hardening", () => {
  const mcqHtml = `<!doctype html><html><head><title>R</title></head><body><div></div>
<script>
var correctAnswers = {"1":"TRUE"};
var questionTypes = {"1":"True/False/Not Given","4":"MCQ","5":"MCQ"};
var mcqGroups = {"4-5": {"qs":[4,5],"correct":["A","C"]}};
</script></body></html>`;
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(mcqHtml);
  });

  it("сырой mcq-файл ловится гейтом (короткие буквы не пропускаются)", () => {
    expect(() => assertNoKeyLeak(mcqHtml, r.parsed)).toThrow(/key/i);
  });

  it("sanitize вырезает mcqGroups, после чего гейт чист", () => {
    const out = sanitizeRunner(mcqHtml, { contentItemId: "cid-3", section: "reading" });
    expect(out).toMatch(/var mcqGroups\s*=\s*\{\}/);
    expect(() => assertNoKeyLeak(out, r.parsed)).not.toThrow();
  });

  it("числовой key-map под нераспознанным именем роняет гейт", async () => {
    const renamed = `<!doctype html><html><head><title>R</title></head><body>
<script>var ANSWERS = {"1":"mining","2":"C","3":"1985","4":"B"};</script></body></html>`;
    const rr = await parseRunner(renamed); // парсер его не видит — 0 вопросов
    const out = sanitizeRunner(renamed, { contentItemId: "cid-4", section: "reading" });
    expect(() => assertNoKeyLeak(out, rr.parsed)).toThrow(/key/i);
  });

  // QA-партия 2026-07-02: у источника Vol7/Mock варианты ответов лежат в
  // acceptableVariants — парсер знал только acceptableAnswers, санитайзер не
  // вырезал объект, детектор (по делу) ронял импорт. Теперь объект вырезается.
  it("вырезает acceptableVariants (альтернативное имя контейнера вариантов)", async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>const correctAnswers = {"1":"raindrops"};
const acceptableVariants = { 1: ['raindrops','raindrop'], 5: ['frogs','frog'], 7: ['x-ray'], 9: ['a b'] };</script>
</body></html>`;
    const rr = await parseRunner(html);
    const out = sanitizeRunner(html, { contentItemId: "cid-6", section: "reading" });
    expect(out).toMatch(/const acceptableVariants\s*=\s*\{\}/);
    expect(() => assertNoKeyLeak(out, rr.parsed)).not.toThrow();
  });

  // Listening Mock (QA 2026-07-02): listening-файл хранит ключ в READING-контейнере
  // correctAnswers — пер-секционные списки вырезания пропускали его целиком.
  // Вырезается объединение всех известных контейнеров независимо от секции.
  it("вырезает reading-контейнеры и в listening-файле (union)", async () => {
    const html = `<!doctype html><html><head><title>L</title></head><body><audio></audio>
<script>const correctAnswers = { 1: 'light', 2: 'manager', 3: 'automatic', 4: 'tires' };</script>
</body></html>`;
    const rr = await parseRunner(html);
    const out = sanitizeRunner(html, { contentItemId: "cid-9", section: "listening" });
    expect(out).toMatch(/const correctAnswers\s*=\s*\{\}/);
    expect(() => assertNoKeyLeak(out, rr.parsed)).not.toThrow();
  });

  // partConfig-кейс (Listening Mock 1): числовые ключи с ОБЪЕКТАМИ-значениями —
  // это UI-конфиг секций, не карта ответов; детектор не должен его ронять.
  it("числовой конфиг с объектами-значениями не даёт ложного срабатывания", async () => {
    const html = `<!doctype html><html><head><title>L</title></head><body><audio src="x.mp3"></audio>
<script>const KEY = {"1":["cat"],"2":["dog"],"3":["sun"],"4":["sky"]};
const partConfig = { 1:{title:"Section 1"}, 2:{title:"Section 2"}, 3:{title:"Section 3"}, 4:{title:"Section 4"} };</script>
</body></html>`;
    const rr = await parseRunner(html);
    const out = sanitizeRunner(html, { contentItemId: "cid-7", section: "listening" });
    expect(() => assertNoKeyLeak(out, rr.parsed)).not.toThrow();
  });

  // Vol5 T10-кейс: UI-строка ' Evidence' (лейбл кнопки) не должна матчиться как
  // литерал ответа "evidence" — \s*-паддинг в проверке давал ложный key leak.
  it("UI-строка с паддингом не матчится как литерал ответа", async () => {
    const html = `<!doctype html><html><head><title>L</title></head><body><audio src="x.mp3"></audio>
<script>const KEY = {"31":["evidence"],"32":["method"],"33":["theory"],"34":["result"]};
function ui(){ const btn = { html: 'Q31' + ' Evidence' }; return btn; }</script>
</body></html>`;
    const rr = await parseRunner(html);
    const out = sanitizeRunner(html, { contentItemId: "cid-8", section: "listening" });
    expect(() => assertNoKeyLeak(out, rr.parsed)).not.toThrow();
  });

  // P2 (2026-07-09): апостроф в комментарии ВНУТРИ объекта ключей рвал баланс скобок в
  // extractObjectLiteral → blankObject молча возвращал src без изменений → сырой
  // correctAnswers уезжал в runner_html (view-source утечка ключа mock-iframe). Правка
  // сканера (comment-aware) чинит обоих потребителей; здесь — санитайзер-потребитель.
  it("вырезает correctAnswers несмотря на апостроф в комментарии внутри объекта (P2)", async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>const correctAnswers = { // don't touch — validated
"1":"mining","2":"tourism","3":"granite","4":"delta" };</script></body></html>`;
    const rr = await parseRunner(html);
    const out = sanitizeRunner(html, { contentItemId: "cid-p2", section: "reading" });
    expect(out).toMatch(/const correctAnswers\s*=\s*\{\}/);
    expect(out).not.toContain("mining"); // ключ НЕ уехал в браузер
    expect(out).not.toContain("tourism");
    expect(() => assertNoKeyLeak(out, rr.parsed)).not.toThrow();
  });

  // Adversarial (Codex, 2026-07-09): комментарий МЕЖДУ `=` и `{` ронял extractObjectLiteral
  // в null до comment-aware цикла → blankObject молча пропускал mcqGroups → correct-набор
  // букв уезжал в runner_html (assertNoKeyLeak не ловит: layer1-regex не матчит `= /*..*/ {`,
  // буквы A/C короче 3 символов). Пре-скан теперь comment-aware — объект вырезается.
  it("вырезает mcqGroups с комментарием между `=` и `{` (P2 vector A)", async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>const correctAnswers = {"1":"A","2":"B","3":"C","4":"D"};
const mcqGroups = /* between */ {"1-4":{"qs":[1,2,3,4],"correct":["A","C"]}};</script></body></html>`;
    const rr = await parseRunner(html);
    const out = sanitizeRunner(html, { contentItemId: "cid-va", section: "reading" });
    expect(out).toMatch(/const mcqGroups\s*=\s*\/\* between \*\/\s*\{\}/);
    expect(out).not.toContain(`"correct":["A","C"]`); // ключ-набор НЕ уехал в браузер
    expect(() => assertNoKeyLeak(out, rr.parsed)).not.toThrow();
  });

  it("время в строках не даёт ложного срабатывания детектора", async () => {
    const benign = `<!doctype html><html><head><title>R</title></head><body>
<script>var correctAnswers = {"1":"TRUE"};
var ui = { labels: ["12:30","13:45","14:00","15:15"] };</script></body></html>`;
    const rb = await parseRunner(benign);
    const out = sanitizeRunner(benign, { contentItemId: "cid-5", section: "reading" });
    expect(() => assertNoKeyLeak(out, rb.parsed)).not.toThrow();
  });

  // Security core: ровно тот сценарий, ради которого существует layer 1. blankObject
  // вырезает объект через `src.replace(literal, "{}")` — String.replace(string, ...)
  // бьёт только по ПЕРВОМУ вхождению подстроки-литерала. Вторая декларация того же
  // имени (другой источник/копипаста в файле) переживает sanitize молча, если бы
  // assertNoKeyLeak сканировал только первую декларацию по имени — layer 1 гоняет
  // regex с флагом "g" по ВСЕМ декларациям specifically ради этого случая.
  it("вторая декларация correctAnswers переживает blankObject — layer 1 её ловит", async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>
var correctAnswers = {"1":"TRUE"};
var questionTypes = {"1":"True/False/Not Given"};
</script>
<script>
var correctAnswers = {"1":"TRUE","2":"leaked-secret-answer"};
</script>
</body></html>`;
    const r = await parseRunner(html);
    const out = sanitizeRunner(html, { contentItemId: "cid-dup", section: "reading" });
    // Доказываем механику дыры перед тем, как проверить, что гейт её ловит.
    expect(out).toMatch(/var correctAnswers\s*=\s*\{\}/); // первая декларация вырезана
    expect(out).toContain("leaked-secret-answer"); // вторая — нет, пережила sanitize
    expect(() => assertNoKeyLeak(out, r.parsed)).toThrow(/key leak/i);
  });
});

// P3 (2026-07-19): blankFunction балансировал скобки посимвольно БЕЗ учёта строковых
// литералов — `}` внутри строки в теле band() (напр. `var s="}"`) обнулял depth
// преждевременно, хвост `";return r;}` приклеивался ПОСЛЕ стаба → SyntaxError, весь
// <script> раннера мёртв (объявления после band не исполнялись). Сканер теперь
// string/comment-aware: тело с `}`-в-строке дожёвывается до реальной закрывающей скобки.
describe("blankFunction — string-aware brace matching (P3)", () => {
  const html = `<!doctype html><html><head><title>L</title></head><body><audio src="x.mp3"></audio>
<script>
function band(r){var s="}";return r;}
const KEY = {"1":["cat"],"2":["dog"],"3":["sun"],"4":["sky"]};
</script></body></html>`;

  const out = sanitizeRunner(html, { contentItemId: "cid-p3", section: "listening" });

  const scriptBodies = (source: string): string[] => {
    const $ = cheerio.load(source);
    return $("script:not([src])")
      .map((_, el) => $(el).html() ?? "")
      .get();
  };

  it("каждый <script> синтаксически валиден (band не рвёт блок)", () => {
    for (const body of scriptBodies(out)) {
      // new Function только парсит тело, не исполняет — ловит именно SyntaxError.
      expect(() => new Function(body)).not.toThrow();
    }
  });

  it("band заглушён, хвоста тела после стаба нет", () => {
    expect(out).toContain("function band(){return 0;}");
    expect(out).not.toContain('";return r;}');
  });

  it("ключ-объект обнулён как обычно", () => {
    expect(out).toMatch(/const KEY\s*=\s*\{\}/);
  });
});

// Inspera Style источник (2026-07-21): 40 `.analysis`/`[data-analysis]` дивов несут
// ПРАВИЛЬНЫЙ ОТВЕТ в тексте (`<strong>TRUE</strong>` и т.п.), скрыты только исходным
// CSS `.analysis{display:none}` — assertNoKeyLeak их не видит (сканирует только
// <script>, не DOM). Раннер обязан вырезать их из DOM руками.
describe("sanitizeRunner — Inspera .analysis DOM leak", () => {
  const html = `<!doctype html><html><head><title>R</title><style>.analysis{display:none}</style></head><body>
<div class="tfng-question" id="question-1">
  <label><input type="radio" name="q1" value="TRUE">TRUE</label>
  <div class="analysis" data-analysis="1">Q1 — Paragraph 1 evidence. <strong>TRUE</strong>.</div>
</div>
<div data-analysis="2">Q2 evidence without the class. <strong>FALSE</strong>.</div>
<script>var correctAnswers = {"1":"TRUE","2":"FALSE"};</script>
</body></html>`;

  const out = sanitizeRunner(html, { contentItemId: "cid-analysis", section: "reading" });

  it("вырезает .analysis-блоки из DOM", () => {
    expect(out).not.toMatch(/class="analysis"/);
    expect(out).not.toMatch(/Paragraph 1 evidence/);
  });

  it("вырезает элементы с [data-analysis], даже без класса .analysis", () => {
    expect(out).not.toMatch(/data-analysis/);
    expect(out).not.toMatch(/Q2 evidence without the class/);
  });

  it("легитимная разметка вопроса не задета", () => {
    expect(out).toContain('id="question-1"');
    expect(out).toContain('value="TRUE"');
  });
});

describe("sanitizeRunner — listening", () => {
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(listening);
  });
  const out = sanitizeRunner(listening, {
    contentItemId: "cid-2",
    section: "listening",
    audioUrl: "https://store.example/audio/cid-2.mp3",
  });
  it("подменяет <audio src> на наш URL", () => {
    expect(out).toContain("https://store.example/audio/cid-2.mp3");
    expect(out).not.toContain("archive.org");
  });
  it("анти-утечка чистая после очистки (evidence вырезан)", () => {
    expect(() => assertNoKeyLeak(out, r.parsed)).not.toThrow();
  });
  it("инжектит мост listening (override doSubmit.onclick)", () => {
    expect(out).toContain("ielts-submit");
    expect(out).toMatch(/getElementById\(['"]doSubmit['"]\)\.onclick/);
  });

  // Критическая граница сужения: голый `.analysis` (без data-analysis) — легитимный
  // results-контейнер дашборда, его JS заполняет в рантайме (#typeBreakdown /
  // #partBreakdown). Прежний широкий `.analysis`-снос вырезал бы его → пустой экран
  // результатов у ВСЕХ listening-раннеров. Атрибут-критерий его сохраняет.
  it("сохраняет listening results-контейнер (.analysis без data-analysis)", () => {
    expect(out).toContain('id="typeBreakdown"');
    expect(out).toContain('id="partBreakdown"');
    expect(out).toMatch(/class="analysis"/);
  });
});

// Read-time защита (route.ts над runner_html + exam-content над questions_html):
// исторические ряды БД импортированы ДО ввода strip'а → несут `[data-analysis]` разборы;
// переимпорт заблокирован (RegradeRequiredError при существующих попытках). Общая
// strip-функция вырезает их на выдаче.
describe("stripAnalysisLeak — read-time defense", () => {
  // questions_html = ФРАГМЕНТ (не полный документ): cheerio.load без isDocument=false
  // обернул бы его в <html><head><body> → порча atomized-рендера QuestionHtml.
  it("на фрагменте questions_html вырезает reveal, НЕ добавляя html/body-обёртку", () => {
    const frag =
      '<div class="mcq-block" id="question-27">' +
      '<p class="mcq-stem">What does the reviewer suggest?</p>' +
      '<label><input type="radio" name="q27" value="B"><span>B</span></label>' +
      '<div class="analysis" data-analysis="27">Q27 — hidden evidence. (<strong>B</strong>)</div>' +
      "</div>";
    const out = stripAnalysisLeak(frag);
    expect(out).not.toMatch(/data-analysis/);
    expect(out).not.toContain("hidden evidence");
    expect(out).toContain('id="question-27"'); // сам вопрос цел
    expect(out).not.toMatch(/<html|<body|<head/i); // обёртка НЕ добавлена
  });

  it("быстрый string-guard: фрагмент без маркера возвращается байт-в-байт", () => {
    const frag = '<div class="mcq-block"><p>Q1</p><input name="q1"></div>';
    expect(stripAnalysisLeak(frag)).toBe(frag);
  });

  // route.ts применяет strip ПОСЛЕ polyfill/skin — на cheerio-реэмиссии. Проверяем,
  // что порядок безопасен: полный runner_html после трансформов + strip остаётся
  // валидным документом (doctype/head целы, инжектнутый шим жив), а разбор вырезан.
  it("read-time strip после polyfill+skin: reveal вырезан, документ и шим целы", () => {
    const polyfilled = polyfillRunnerStorage(reading);
    expect(polyfilled).not.toBeNull();
    const skinned = skinRunnerBrand(skinRunnerGate(polyfilled!));
    const safe = stripAnalysisLeak(skinned);
    expect(safe).not.toMatch(/class="analysis"/);
    expect(safe).not.toContain('beet sugar "has been massively'); // разбор Q27 вырезан
    expect(safe.trimStart().toLowerCase().startsWith("<!doctype")).toBe(true);
    expect(safe).toMatch(/<head[^>]*>/i);
    expect(safe).toContain("getItem"); // polyfill-шим пережил cheerio-реэмиссию
  });

  // listening runner_html: голый .analysis-контейнер переживает read-time strip —
  // маркера [data-analysis] нет → guard = байт-в-байт no-op.
  it("listening runner_html: results-контейнер цел на read-time (guard no-op)", () => {
    expect(stripAnalysisLeak(listening)).toBe(listening);
  });
});
