import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRunner, diagnoseEmptyRunnerParse } from "./parse-runner";
import { sanitizeRunner, assertNoKeyLeak } from "./sanitize-runner";
import { isUnresolvedQuestionTypeWarning } from "../question-types";

const FIX = join(__dirname, "fixtures");
const reading = readFileSync(join(FIX, "reading.html"), "utf8");
const listening = readFileSync(join(FIX, "listening.html"), "utf8");
const inspera = readFileSync(join(FIX, "reading-inspera.html"), "utf8");

describe("parseRunner — reading", () => {
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(reading);
  });
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

// Inspera Style (2026-07-21): band-таблица лежит в getBandFor13, а getBandFor40
// лишь делегирует к ней (`return getBandFor13(s)`). Извлечение getBandFor40 в изоляции
// падало ReferenceError (getBandFor13 вне vm) -> bandScale=null -> publish-гейт
// full_missing_band_scale. Фолбэк на getBandFor13 в цепочке кандидатов чинит блокер.
describe("parseRunner — band делегируется getBandFor40 -> getBandFor13", () => {
  const html = `<!doctype html><html><head><title>R</title></head><body>
<script>
var correctAnswers = {"1":"TRUE","40":"FALSE"};
function getBandFor13(s){ if(s>=39) return 9; if(s>=10) return 4; return 0; }
function getBandFor40(s){ return getBandFor13(s); }
</script></body></html>`;
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(html);
  });
  it("bandScale материализуется 0..40 через фолбэк на getBandFor13", () => {
    expect(r.parsed.bandScale).not.toBeNull();
    expect(Object.keys(r.parsed.bandScale!)).toHaveLength(41);
    expect(r.parsed.bandScale!["40"]).toBe(9);
    expect(r.parsed.bandScale!["0"]).toBe(0);
  });
});

// Дефект текстового гейта (ревью 2026-07-21): getBandFor40 упоминает getBandFor13 ЛИШЬ
// в комментарии, тело — заглушка без вызова (return null). Рядом лежит самостоятельная
// legacy getBandFor13 (13-шкала). Старый гейт видел подстроку getBandFor13 в теле-комменте
// → ложный delegates=true → извлекал standalone 13-шкалу как 0..40 → full_reading. Семантика
// (со-определение в vm) не ошибается: вызова нет → getBandFor40 даёт пустую таблицу → null.
describe("parseRunner — упоминание getBandFor13 в комментарии getBandFor40 не делает full", () => {
  const html = `<!doctype html><html><head><title>Comment Only</title></head><body>
<script>
var correctAnswers = {${Array.from({ length: 13 }, (_, i) => `"${i + 1}":"TRUE"`).join(",")}};
function getBandFor13(s){ if(s>=13) return 9.0; if(s>=10) return 7.5; if(s>=6) return 5.5; return 0; }
function getBandFor40(s){ /* would call getBandFor13(s) but disabled */ return null; }
</script></body></html>`;
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(html);
  });
  it("bandScale null (getBandFor40 не вызывает getBandFor13)", () => {
    expect(r.parsed.bandScale).toBeNull();
  });
  it("категория passage_1, не full_reading", () => {
    expect(r.parsed.category).toBe("passage_1");
    expect(r.parsed.durationSeconds).toBe(20 * 60);
  });
});

// Дефект текстового гейта (ревью 2026-07-21): валидный МНОГОСТРОЧНЫЙ делегатор с вложенным
// if{} до вызова. Старый non-greedy regex `{([\s\S]*?)}` обрывался на внутренней `}` →
// getBandFor13 не виден в захваченном теле → ложный delegates=false → bandScale null.
// Со-определение в vm-harness вызывает делегатор целиком (balanced braces) → шкала.
describe("parseRunner — многострочный делегатор getBandFor40 -> getBandFor13", () => {
  const html = `<!doctype html><html><head><title>Multiline</title></head><body>
<script>
var correctAnswers = {"1":"TRUE","40":"FALSE"};
function getBandFor13(s){ if(s>=39) return 9; if(s>=10) return 4; return 0; }
function getBandFor40(s){ if (s < 0) { return null; } return getBandFor13(s); }
</script></body></html>`;
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(html);
  });
  it("шкала извлекается 0..40 несмотря на вложенный if{} до вызова", () => {
    expect(r.parsed.bandScale).not.toBeNull();
    expect(Object.keys(r.parsed.bandScale!)).toHaveLength(41);
    expect(r.parsed.bandScale!["40"]).toBe(9);
    expect(r.parsed.bandScale!["0"]).toBe(0);
  });
});

// Регресс 2026-07-21: legacy одиночный Reading несёт САМОСТОЯТЕЛЬНУЮ getBandFor13
// (13-вопросная шкала) БЕЗ делегирующего getBandFor40. Безусловный фолбэк на
// getBandFor13 материализовал её как 0..40-таблицу (s>=13 → 9 для всех r∈13..40),
// bandScale становился !=null → isFull → full_reading/60m вместо passage_1/20m.
// Фолбэк законен только при доказанном делегировании (getBandFor40 → getBandFor13).
describe("parseRunner — standalone getBandFor13 (legacy single passage) остаётся passage_1", () => {
  const html = `<!doctype html><html><head><title>Legacy Single</title></head><body>
<script>
var correctAnswers = {${Array.from({ length: 13 }, (_, i) => `"${i + 1}":"TRUE"`).join(",")}};
function getBandFor13(s){
  if(s>=13) return 9.0; if(s>=10) return 7.5; if(s>=6) return 5.5; if(s>=3) return 4.0; return 0;
}
</script></body></html>`;
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(html);
  });
  it("standalone getBandFor13 без getBandFor40 не извлекается как 40-шкала", () => {
    expect(r.parsed.bandScale).toBeNull();
  });
  it("категория/длительность одиночного пассажа, не full_reading", () => {
    expect(r.parsed.category).toBe("passage_1");
    expect(r.parsed.durationSeconds).toBe(20 * 60);
  });
});

// HIGH-находка ревью (2026-07-21): comment-aware извлечение band-функций на уровне
// parseRunner. getBandFor13 закомментирована ЦЕЛИКОМ (декларации в источнике фактически
// нет), рядом реальный getBandFor40-каллер. Не-comment-aware extractFunctionText матчил
// `function getBandFor13` внутри /* */ → материализовал как dep → getBandFor40 отрабатывал
// → ложный bandScale → full_reading/60m. Маска-подход: закомментированная декларация не
// матчится → dep undefined → getBandFor40 падает ReferenceError → null → passage_1/20m.
describe("parseRunner — закомментированная getBandFor13 + реальный getBandFor40 остаётся passage_1", () => {
  const html = `<!doctype html><html><head><title>Commented Dep</title></head><body>
<script>
var correctAnswers = {${Array.from({ length: 13 }, (_, i) => `"${i + 1}":"TRUE"`).join(",")}};
/* function getBandFor13(s){ if(s>=39) return 9; return 4; } */
function getBandFor40(s){ return getBandFor13(s); }
</script></body></html>`;
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(html);
  });
  it("закомментированный dep не материализуется → bandScale null", () => {
    expect(r.parsed.bandScale).toBeNull();
  });
  it("категория passage_1, не full_reading", () => {
    expect(r.parsed.category).toBe("passage_1");
    expect(r.parsed.durationSeconds).toBe(20 * 60);
  });
});

// QA 2026-07-02: источник Vol7/Mock хранит варианты в acceptableVariants (не
// acceptableAnswers) — без него варианты терялись (вопрос падал в exact), а
// невырезанный объект ронял импорт на анти-утечке.
describe("parseRunner — acceptableVariants (альтернативное имя)", () => {
  const html = `<!doctype html><html><head><title>R</title></head><body>
<script>
var correctAnswers = {"1":"raindrops","2":"TRUE"};
const acceptableVariants = { 1: ['raindrops','raindrop'] };
</script></body></html>`;
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(html);
  });
  it("варианты из acceptableVariants → text_accept", () => {
    const q1 = r.parsed.questions.find((q) => q.number === 1)!;
    expect(q1.answer.mode).toBe("text_accept");
    expect(q1.answer.accept).toEqual(["raindrops", "raindrop"]);
    const q2 = r.parsed.questions.find((q) => q.number === 2)!;
    expect(q2.answer.mode).toBe("exact");
  });
});

// Vol7/Mock (QA 2026-07-02): источник без band-функции ронял 40-вопросный тест в
// passage_1/part_1 (20/10 мин) — категорию страхует счёт вопросов.
describe("parseRunner — full-категория по числу вопросов (без band-функции)", () => {
  it("reading 40q без getBandFor40 → full_reading / 60m", async () => {
    const entries = Array.from({ length: 40 }, (_, i) => `"${i + 1}":"TRUE"`).join(",");
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>const correctAnswers = {${entries}};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    expect(parsed.category).toBe("full_reading");
    expect(parsed.durationSeconds).toBe(60 * 60);
  });
  // F3-min (2026-07-12): парсер сам не блокирует (publish-гейт — фактический блокер), но
  // должен поднять warning для review-экрана, когда full-тест остался без band-шкалы.
  it("reading 40q без getBandFor40 → warning про отсутствующую band-шкалу", async () => {
    const entries = Array.from({ length: 40 }, (_, i) => `"${i + 1}":"TRUE"`).join(",");
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>const correctAnswers = {${entries}};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    expect(parsed.bandScale).toBeNull();
    expect(parsed.warnings.some((w) => /band scale/i.test(w))).toBe(true);
  });
  it("listening 40q без band() → full_listening / 30m", async () => {
    const entries = Array.from({ length: 40 }, (_, i) => `"${i + 1}":["w${i}"]`).join(",");
    const html = `<!doctype html><html><head><title>L</title></head><body><audio></audio>
<script>const KEY = {${entries}};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    expect(parsed.category).toBe("full_listening");
    expect(parsed.durationSeconds).toBe(30 * 60);
  });
  it("listening 40q без band() → warning про отсутствующую band-шкалу", async () => {
    const entries = Array.from({ length: 40 }, (_, i) => `"${i + 1}":["w${i}"]`).join(",");
    const html = `<!doctype html><html><head><title>L</title></head><body><audio></audio>
<script>const KEY = {${entries}};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    expect(parsed.bandScale).toBeNull();
    expect(parsed.warnings.some((w) => /band scale/i.test(w))).toBe(true);
  });
  it("одиночный пассаж 13q остаётся passage_1", async () => {
    const entries = Array.from({ length: 13 }, (_, i) => `"${i + 1}":"TRUE"`).join(",");
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>const correctAnswers = {${entries}};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    expect(parsed.category).toBe("passage_1");
  });
});

// Listening Mock (QA 2026-07-02): listening-файл без KEY — ключ в reading-контейнерах
// (correctAnswers + acceptableVariants). Fallback приводит их к форме KEY.
describe("parseRunner — listening fallback на reading-контейнеры", () => {
  const html = `<!doctype html><html><head><title>Listening Mock</title></head><body><audio></audio>
<script>
const correctAnswers = { 1: 'light', 2: 'manager', 11: 'B' };
const acceptableVariants = { 2: ['manager','managers'] };
const questionTypes = {"1":"Note completion","2":"Note completion","11":"MCQ"};
</script></body></html>`;
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(html);
  });
  it("вопросы распознаны, варианты подхвачены", () => {
    expect(r.parsed.section).toBe("listening");
    expect(r.parsed.questions).toHaveLength(3);
    const q1 = r.parsed.questions.find((q) => q.number === 1)!;
    expect(q1.answer.accept).toEqual(["light"]);
    const q2 = r.parsed.questions.find((q) => q.number === 2)!;
    expect(q2.answer.mode).toBe("text_accept");
    expect(q2.answer.accept).toEqual(["manager", "managers"]);
  });
  it("типы берутся из questionTypes, когда QTYPE отсутствует", () => {
    const q1 = r.parsed.questions.find((q) => q.number === 1)!;
    expect(q1.qtype).toBe("note_completion");
  });
});

// #7: Reading "choose TWO/THREE" — mcqGroups keys the members as one mcq_set so the
// letter-set is graded correctly. Member 4,5 live ONLY in mcqGroups (not correctAnswers)
// to prove the union pulls them in. Previously they fell to exact/text_accept (wrong grade).
const readingWithMcqSet = `<!doctype html><html><head><title>MCQ</title></head><body>
<script>
var correctAnswers = {"1":"TRUE"};
var acceptableAnswers = {};
var questionTypes = {"1":"True/False/Not Given"};
var mcqGroups = {"4-5": {"qs":[4,5],"correct":["A","C"]}};
</script></body></html>`;

describe("parseRunner — reading mcq_set (#7)", () => {
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(readingWithMcqSet);
  });
  const q = (n: number) => r.parsed.questions.find((x) => x.number === n)!;
  it("члены mcqGroups → mcq_set + mcq_multi + groupKey (даже вне correctAnswers)", () => {
    expect(q(4).answer).toMatchObject({ mode: "mcq_set", accept: ["A", "C"] });
    expect(q(4).qtype).toBe("mcq_multi");
    expect(q(4).groupKey).toBe("4-5");
    expect(q(5).answer.mode).toBe("mcq_set");
    expect(q(5).answer.accept).toEqual(["A", "C"]);
  });
  it("не-mcq вопросы остаются exact/text_accept", () => {
    expect(q(1).answer.mode).toBe("exact");
    expect(q(1).answer.accept).toEqual(["TRUE"]);
  });
  it("questionTypes включает mcq_multi", () => {
    expect(r.parsed.questionTypes).toContain("mcq_multi");
  });
});

// Multi-select guard (вариант B): reading-вопрос с МАССИВОМ в correctAnswers, но БЕЗ
// записи в mcqGroups — вероятный choose-TWO/THREE, оформленный не по authoring-спеке.
// Парсер НЕ меняет выход (mode/accept — тот же NORM-артефакт), только поднимает warning
// на review-экран: админ обязан добавить mcqGroups-диапазон. Массив длины 1 — не multi.
describe("parseRunner — array-shaped correct answer without mcqGroups", () => {
  it("массив длины 2 без mcqGroups → warning; mode/accept НЕ меняются (exact + NORM-артефакт)", async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>var correctAnswers = {"1":["B","D"]};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    const q1 = parsed.questions.find((q) => q.number === 1)!;
    expect(q1.answer.mode).toBe("exact");
    expect(q1.answer.accept).toEqual(["B,D"]); // выход не тронут: String(["B","D"]) → "B,D"
    expect(parsed.warnings.some((w) => /Q1/.test(w) && /mcqGroups/i.test(w))).toBe(true);
  });

  it("массив длины 1 → НЕ триггерит warning (не multi-select)", async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>var correctAnswers = {"1":["B"]};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    expect(parsed.warnings.some((w) => /Q1/.test(w) && /mcqGroups/i.test(w))).toBe(false);
  });

  it("номер есть в mcqGroups → array-warning не поднимается (mcqGroups-ветка приоритетна)", async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>var correctAnswers = {"1":["B","D"]};
var mcqGroups = {"1-2": {"qs":[1,2],"correct":["B","D"]}};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    const q1 = parsed.questions.find((q) => q.number === 1)!;
    expect(q1.answer.mode).toBe("mcq_set"); // mcqGroups-ветка отработала
    expect(parsed.warnings.some((w) => /Q1/.test(w) && /mcqGroups/i.test(w) && /array/i.test(w))).toBe(false);
  });
});

// Multi-select guard по LABEL (вариант B): реальные корпусные ярлыки choose-TWO без
// mcqGroups (Cambridge 21 Reading Test 2 "Multiple Choice (TWO answers)"; Vol7 Test 3
// "Multiple Choice (Two Answers)"). Warning поднимается, но qtype/mode/accept — как раньше.
describe("parseRunner — choose-TWO/THREE label without mcqGroups", () => {
  it('"Multiple Choice (TWO answers)" без mcqGroups → warning; qtype/mode/accept НЕ меняются', async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>var correctAnswers = {"20":"B","21":"D"};
var questionTypes = {"20":"Multiple Choice (TWO answers)","21":"Multiple Choice (TWO answers)"};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    const q20 = parsed.questions.find((q) => q.number === 20)!;
    expect(q20.qtype).toBe("mcq_single"); // выход не тронут (CONTAINS multiplechoice)
    expect(q20.answer.mode).toBe("exact");
    expect(q20.answer.accept).toEqual(["B"]);
    expect(parsed.warnings.some((w) => /Q20/.test(w) && /mcqGroups/i.test(w))).toBe(true);
  });

  it('"Multiple Choice (Two Answers)" без mcqGroups → warning', async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>var correctAnswers = {"21":"A","22":"C"};
var questionTypes = {"21":"Multiple Choice (Two Answers)","22":"Multiple Choice (Two Answers)"};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    expect(parsed.warnings.some((w) => /Q21/.test(w) && /mcqGroups/i.test(w))).toBe(true);
  });

  it('plain "Multiple Choice" → нет choose-many warning', async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>var correctAnswers = {"1":"B"};var questionTypes = {"1":"Multiple Choice"};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    expect(parsed.warnings.some((w) => /Q1/.test(w) && /mcqGroups/i.test(w))).toBe(false);
  });

  it('"Note completion (two words)" → нет warning (защита от голого "two")', async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>var correctAnswers = {"1":"raindrops"};var questionTypes = {"1":"Note completion (two words)"};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    expect(parsed.warnings.some((w) => /Q1/.test(w) && /mcqGroups/i.test(w))).toBe(false);
  });

  it("TWO-label, но номер в mcqGroups → нет choose-many warning (mcqGroups приоритетна)", async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>var correctAnswers = {"20":"B"};
var questionTypes = {"20":"Multiple Choice (TWO answers)"};
var mcqGroups = {"20-21": {"qs":[20,21],"correct":["B","D"]}};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    const q20 = parsed.questions.find((q) => q.number === 20)!;
    expect(q20.answer.mode).toBe("mcq_set"); // mcqGroups-ветка отработала
    expect(parsed.warnings.some((w) => /Q20/.test(w) && /mcqGroups/i.test(w))).toBe(false);
  });
});

// Номер пассажа из шапки стартового экрана (2026-07-21): клиентский Inspera-генератор
// шлёт одиночные пассажи с явным «Reading Passage N» в `#startScreen`/`.start-screen`
// → категория должна быть passage_N, а не хардкод passage_1. Якорь — заголовок
// стартового экрана, НЕ первое вхождение по файлу (иначе «Reading Passage 2 has five
// sections» в тексте рубрики дало бы ложный детект).
describe("parseRunner — номер пассажа из стартового экрана", () => {
  const single = (heading: string, wrapper = 'id="startScreen"') =>
    `<!doctype html><html><head><title>R</title></head><body>
<div ${wrapper} class="start-screen"><div class="start-content">
  <h1>${heading}</h1><h2>The plan to bring an asteroid to Earth</h2>
</div></div>
<script>var correctAnswers = {"14":"C","15":"i","16":"ii"};
var questionTypes = {"14":"Multiple Choice","15":"Matching Headings","16":"Matching Headings"};</script>
</body></html>`;

  it('«Reading Passage 2» в h1 стартового экрана → passage_2 / 20m', async () => {
    const { parsed } = await parseRunner(single("Reading Passage 2"));
    expect(parsed.category).toBe("passage_2");
    expect(parsed.durationSeconds).toBe(20 * 60);
  });

  it('короткий «Passage 3» и wrapper по классу .start-screen → passage_3', async () => {
    const { parsed } = await parseRunner(single("Passage 3", 'data-x="1"'));
    expect(parsed.category).toBe("passage_3");
  });

  it("нет стартового экрана → прежний дефолт passage_1 (без варнинга)", async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>var correctAnswers = {"1":"TRUE","2":"FALSE"};var questionTypes = {"1":"TFNG","2":"TFNG"};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    expect(parsed.category).toBe("passage_1");
    expect(parsed.warnings.some((w) => /passage/i.test(w))).toBe(false);
  });

  it("«Reading Passage 2» только в ТЕКСТЕ рубрики (не в шапке) → НЕ детектится, passage_1", async () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<div id="startScreen" class="start-screen"><h1>Silent Reading</h1></div>
<div class="question-rubric"><p>Reading Passage 2 has five sections, A-E.</p></div>
<script>var correctAnswers = {"1":"TRUE"};var questionTypes = {"1":"TFNG"};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    expect(parsed.category).toBe("passage_1");
  });

  it("full-тест не переопределяется номером пассажа из шапки (остаётся full_reading)", async () => {
    const entries = Array.from({ length: 40 }, (_, i) => `"${i + 1}":"TRUE"`).join(",");
    const html = `<!doctype html><html><head><title>R</title></head><body>
<div id="startScreen" class="start-screen"><h1>Reading Passage 2</h1></div>
<script>const correctAnswers = {${entries}};</script></body></html>`;
    const { parsed } = await parseRunner(html);
    expect(parsed.category).toBe("full_reading");
  });
});

describe("parseRunner — listening", () => {
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(listening);
  });
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

describe("parseRunner — listening qtype", () => {
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(listening);
  });
  const qt = (n: number) => r.parsed.questions.find((q) => q.number === n)!.qtype;
  it("маппит qtype из QTYPE range-builder (не всё short_answer)", () => {
    expect(qt(1)).toBe("table_completion");
    expect(qt(7)).toBe("note_completion");
    expect(qt(11)).toBe("mcq_single");
    expect(qt(17)).toBe("matching_info");
    expect(new Set(r.parsed.questions.map((q) => q.qtype)).size).toBeGreaterThan(1);
  });
});

// Review-gate (Task B): parser должен ПОДНИМАТЬ low-confidence места, а не молча
// фоллбэчить. Q2 — неизвестный тип + пустой ключ; Q3 — fuzzy-тип (CONTAINS).
const readingWithIssues = `<!doctype html><html><head><title>WTest</title></head><body>
<script>
var correctAnswers = {"1":"TRUE","2":"","3":"A"};
var questionTypes = {"1":"True/False/Not Given","2":"Frobnicate","3":"Some Matching"};
</script></body></html>`;

describe("parseRunner — warnings (review gate)", () => {
  let w: string[];
  beforeAll(async () => {
    w = (await parseRunner(readingWithIssues)).parsed.warnings;
  });
  it("флагует неизвестный тип с фоллбэком на short_answer", () => {
    expect(w.some((x) => /Q2/.test(x) && /short_answer/i.test(x))).toBe(true);
  });
  it("флагует низко-уверенный (fuzzy) тип", () => {
    expect(w.some((x) => /Q3/.test(x) && /matching_info/.test(x))).toBe(true);
  });
  it("флагует пустой ключ", () => {
    expect(w.some((x) => /Q2/.test(x) && /key/i.test(x))).toBe(true);
  });
  it("чистый файл: нет unknown-type / empty-key warnings", async () => {
    const clean = (await parseRunner(reading)).parsed.warnings;
    expect(clean.some((x) => /unknown type|empty answer key/i.test(x))).toBe(false);
  });
});

// QTYPE hard-block (2026-07-11): парсер сам по себе НЕ меняет поведение — пустой qtype
// по-прежнему эмитит blankTypeWarning (отдельный текст от unknownTypeWarning), непустой
// мусор — unknownTypeWarning с fallback на short_answer. Изменился только publish-гейт
// (question-types.ts): раньше (P1, 2026-07-09) blankTypeWarning не считался блокирующим,
// теперь — считается наравне с unknownTypeWarning.
describe("parseRunner — пустой qtype блокирует publish (QTYPE hard-block)", () => {
  const blankHtml = `<!doctype html><html><head><title>R</title></head><body>
<script>var correctAnswers = {"1":"TRUE","2":"FALSE"};var questionTypes = {};</script></body></html>`;
  let w: string[];
  beforeAll(async () => {
    w = (await parseRunner(blankHtml)).parsed.warnings;
  });

  it("пустой qtype даёт блокирующий warning", () => {
    expect(w.some(isUnresolvedQuestionTypeWarning)).toBe(true);
  });

  it("warning про тип информативен (виден админу, содержит номер вопроса)", () => {
    expect(w.some((x) => /Q1/.test(x) && /type/i.test(x))).toBe(true);
  });

  it("непустой нераспознанный тип в том же файле тоже остаётся блокирующим", async () => {
    const mixed = `<!doctype html><html><head><title>R</title></head><body>
<script>var correctAnswers = {"1":"TRUE"};var questionTypes = {"1":"Frobnicate"};</script></body></html>`;
    expect((await parseRunner(mixed)).parsed.warnings.some(isUnresolvedQuestionTypeWarning)).toBe(true);
  });

  it("файл с валидными типами на всех вопросах не даёт блокирующих warning'ов", async () => {
    expect((await parseRunner(reading)).parsed.warnings.some(isUnresolvedQuestionTypeWarning)).toBe(false);
  });
});

// P4 (2026-07-09): при 0 распознанных вопросов различаем два отказа — контейнер ключа
// вообще не найден (bespoke-генератор под чужим именем) vs. контейнер есть, но номера
// вопросов не распознаны. Разное сообщение помогает админу понять причину отказа.
describe("diagnoseEmptyRunnerParse (P4)", () => {
  it("контейнер ключа не найден (чужое имя) → сообщение про ненайденный контейнер", () => {
    const msg = diagnoseEmptyRunnerParse(`<script>const answers = {"1":"A","2":"B"};</script>`);
    expect(msg).toMatch(/container not found/i);
  });

  it("нет inline-скрипта → контейнер не найден", () => {
    expect(diagnoseEmptyRunnerParse(`<div>no script here</div>`)).toMatch(/container not found/i);
  });

  it("контейнер найден, но номера не распознаны → другое сообщение с именем контейнера", () => {
    const msg = diagnoseEmptyRunnerParse(`<script>const correctAnswers = {"q1":"A","q2":"B"};</script>`);
    expect(msg).toMatch(/answer key found/i);
    expect(msg).toMatch(/correctAnswers/);
  });

  // Codex-ревью (2026-07-09): детекция должна требовать реальный `{...}`-литерал, а не имя
  // как подстроку в строке/тексте (иначе ложное "found").
  it("имя контейнера лишь как подстрока в строке → НЕ считается объявлением", () => {
    const msg = diagnoseEmptyRunnerParse(`<script>const note = "const correctAnswers = here";</script>`);
    expect(msg).toMatch(/container not found/i);
  });
});

// Codex-ревью (2026-07-09): bespoke-ключи "q1".."q40" под распознанным именем давали
// вопрос с number=NaN (падал на persist-integer) вместо чистого 0-вопросного отказа.
describe("parseRunner — нечисловые/неположительные ключи не создают вопросов (P4)", () => {
  it("q-префиксные ключи reading → 0 распознанных вопросов", async () => {
    const { parsed } = await parseRunner(`<script>const correctAnswers = {"q1":"A","q2":"B","q40":"C"};</script>`);
    expect(parsed.questions).toHaveLength(0);
  });
  it("q-префиксные ключи listening → 0 распознанных вопросов", async () => {
    const { parsed } = await parseRunner(
      `<script>const KEY = {"q1":["a"],"q2":["b"]};</script><audio></audio><div class="part" data-part="1"></div>`,
    );
    expect(parsed.questions).toHaveLength(0);
  });
  it("валидные числовые ключи по-прежнему дают вопросы", async () => {
    const { parsed } = await parseRunner(`<script>const correctAnswers = {"1":"A","2":"B"};</script>`);
    expect(parsed.questions.map((q) => q.number)).toEqual([1, 2]);
  });
});

// --- Inspera Style golden fixture (committed, 2026-07-21) ---
// Полностью синтетический мини-тест канонического клиентского формата: 3 пассажа,
// 16 вопросов непрерывной нумерации, 8 типов ×2. Интегральная проверка ВСЕГО файла
// (runner-путь ключа/типов/band + анти-утечка sanitizeRunner) — в отличие от точечных
// inline-фикстур выше и в parse-reading-full.test.ts, гоняющих отдельные фиксы.
describe("parseRunner — Inspera golden fixture (весь файл)", () => {
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(inspera);
  });
  const q = (n: number) => r.parsed.questions.find((x) => x.number === n)!;

  it("section reading, 16 вопросов непрерывной нумерации 1..16, у каждого непустой ключ", () => {
    expect(r.parsed.section).toBe("reading");
    expect(r.parsed.questions.map((x) => x.number)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
    expect(r.parsed.questions.every((x) => x.answer.accept.length > 0)).toBe(true);
  });

  it("qtype каждого типа канонизирован (8 типов ×2)", () => {
    expect(q(1).qtype).toBe("tfng");
    expect(q(3).qtype).toBe("note_completion");
    expect(q(5).qtype).toBe("matching_headings");
    expect(q(7).qtype).toBe("matching_info");
    expect(q(9).qtype).toBe("summary_completion");
    expect(q(11).qtype).toBe("mcq_single");
    expect(q(13).qtype).toBe("matching_sentence_endings");
    expect(q(15).qtype).toBe("ynng");
  });

  it("ключ маршрутизирован: acceptableAnswers→text_accept, иначе correctAnswers→exact", () => {
    expect(q(3).answer).toMatchObject({ mode: "text_accept", accept: ["lanterns", "lantern"] });
    expect(q(1).answer).toMatchObject({ mode: "exact", accept: ["TRUE"] });
    expect(q(7).answer).toMatchObject({ mode: "exact", accept: ["C"] });
  });

  it("band делегируется getBandFor40 -> getBandFor13, шкала непустая 0..40", () => {
    expect(r.parsed.bandScale).not.toBeNull();
    expect(Object.keys(r.parsed.bandScale!)).toHaveLength(41);
    expect(r.parsed.bandScale!["40"]).toBe(9);
    expect(r.parsed.bandScale!["0"]).toBe(0);
    expect(r.parsed.category).toBe("full_reading");
  });

  it("explanation/evidence подхватываются из data-объектов", () => {
    expect(q(1).answer.explanation).toMatch(/human effort/i);
    expect(q(1).answer.evidence?.snippet).toMatch(/human effort/i);
  });

  // Анти-утечка (BRIEF §6.1): sanitizeRunner обязан вырезать .analysis-дивы (несут ответ
  // в тексте, скрыты лишь CSS) и заглушить key-объекты — иначе ответ утёк бы в iframe.
  it("sanitizeRunner вырезает .analysis-дивы и синтетические ответы фикстуры", () => {
    const out = sanitizeRunner(inspera, { contentItemId: "golden-test", section: "reading" });
    expect(out).not.toContain("data-analysis");
    expect(out).not.toContain('class="analysis"');
    for (const word of ["lanterns", "lantern", "copper", "harbour", "harbor", "ledger"]) {
      expect(out.toLowerCase()).not.toContain(word);
    }
    expect(() => assertNoKeyLeak(out, r.parsed)).not.toThrow();
  });
});
