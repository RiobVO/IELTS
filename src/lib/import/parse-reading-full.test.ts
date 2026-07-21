// Тесты Full-Reading парсера (BRIEF §4.2). Inline-фикстура повторяет селекторы
// parse-reading-full.ts; маршрут через диспетчер parseTest (≥2 .passage-section).
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTest } from "./parse-test";
import { parseRunner } from "./runner/parse-runner";
import { mergeAtomization } from "./runner/atomize-merge";
import { isUnresolvedQuestionTypeWarning, UNKNOWN_TYPE_FALLBACK } from "./question-types";

const sample = (name: string): string | null => {
  const p = fileURLToPath(new URL(`../../../samples/${name}`, import.meta.url));
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

const FULL_HTML = `<!doctype html><html><head><title>Full Reading - Template</title></head>
<body>
  <section class="passage-section" data-part="1">
    <div class="sectionRubric"><h2>The First Passage</h2></div>
    <div class="passage-content">
      <p>Body of passage one.</p>
      <script>window.evil = 1;</script>
      <p onclick="steal()">Handler.</p>
      <a href="javascript:alert(1)">x</a>
    </div>
  </section>
  <section class="passage-section" data-part="2">
    <div class="sectionRubric"><h2>The Second Passage</h2></div>
    <div class="passage-content"><p>Body of passage two.</p></div>
  </section>

  <div class="questions-section" data-part="1">
    <div class="tfng-question" id="question-1">
      <p class="tfng-statement-text">Statement one.</p>
      <label><input type="radio" name="q1" value="TRUE">True</label>
      <label><input type="radio" name="q1" value="FALSE">False</label>
      <label><input type="radio" name="q1" value="NOT GIVEN">Not Given</label>
    </div>
    <p>The gas is <input type="text" name="q2"> in the air.</p>
  </div>

  <div class="questions-section" data-part="2">
    <table class="matching-table">
      <tr id="question-3">
        <td class="q-text">Statement three</td>
        <td><input type="radio" name="q3" value="A"></td>
        <td><input type="radio" name="q3" value="B"></td>
        <td><input type="radio" name="q3" value="C"></td>
      </tr>
    </table>
    <div class="mc-question" data-mcq-group="4-5" data-correct="A,C">
      <p class="tfng-statement-text">Choose TWO letters.</p>
      <label><input type="checkbox" value="A">Alpha</label>
      <label><input type="checkbox" value="B">Beta</label>
      <label><input type="checkbox" value="C">Gamma</label>
      <span class="review-flag" data-q="4"></span>
      <span class="review-flag" data-q="5"></span>
    </div>
  </div>

  <script>
    const correctAnswers = { "1": "TRUE", "2": "Oxygen", "3": "B", "4": "A,C", "5": "A,C" };
    const acceptableVariants = { "2": ["Oxygen", "O2"] };
    const questionTypes = { "1": "True/False/Not Given", "2": "Note Completion", "3": "Matching Features" };
    function getBand(s){ return s >= 39 ? 9 : 5; }
  </script>
</body></html>`;

describe("parseFullReading — inline (2 passages)", () => {
  let t: Awaited<ReturnType<typeof parseTest>>;
  beforeAll(async () => {
    t = await parseTest(FULL_HTML); // через диспетчер
  });
  const q = (n: number) => t.questions.find((x) => x.number === n)!;

  it("диспетчеризуется в full reading и строит по пассажу на секцию", () => {
    expect(t.section).toBe("reading");
    expect(t.category).toBe("full_reading");
    expect(t.durationSeconds).toBe(3600); // IELTS Reading: 60 мин
    expect(t.passages).toHaveLength(2);
    expect(t.passages.map((p) => p.order)).toEqual([1, 2]);
  });

  it("санитайзит секции пассажей (XSS)", () => {
    const body = t.passages[0].bodyHtml;
    expect(body).toContain("Body of passage one");
    expect(body).not.toContain("window.evil");
    expect(body).not.toContain("onclick");
    expect(body).not.toContain("javascript:");
  });

  it("мапит вопрос на пассаж по секции [data-part]", () => {
    expect(q(1).passageOrder).toBe(1);
    expect(q(2).passageOrder).toBe(1);
    expect(q(3).passageOrder).toBe(2);
    expect(q(4).passageOrder).toBe(2);
  });

  it("маршрутизирует ключ: acceptableVariants→text_accept, correctAnswers→exact, чекбоксы→mcq_set", () => {
    expect(q(1).answer).toMatchObject({ mode: "exact", accept: ["TRUE"] });
    expect(q(2).answer).toMatchObject({ mode: "text_accept", accept: ["Oxygen", "O2"] });
    expect(q(3).answer).toMatchObject({ mode: "exact", accept: ["B"] });
    expect(q(4).answer).toMatchObject({ mode: "mcq_set", accept: ["A", "C"] });
    expect(q(4).qtype).toBe("mcq_multi");
  });

  it("материализует getBand и не плодит предупреждений на чистом входе", () => {
    expect(t.bandScale).not.toBeNull();
    expect(Object.keys(t.bandScale!)).toHaveLength(41);
    expect(t.warnings).toHaveLength(0);
  });
});

// Fix 2026-07-19: зеркало кейса parse-test — самодельный «unknown question type label»
// не матчился publish-гейтом; теперь канонический envelope + fallback (как parse-runner).
const FULL_UNKNOWN_TYPE_HTML = `<!doctype html><html><head><title>Full Reading - Unknown</title></head>
<body>
  <section class="passage-section" data-part="1">
    <div class="sectionRubric"><h2>Reading Passage 1</h2></div>
    <div class="passage-content"><p>Body one.</p></div>
  </section>
  <section class="passage-section" data-part="2">
    <div class="sectionRubric"><h2>Reading Passage 2</h2></div>
    <div class="passage-content"><p>Body two.</p></div>
  </section>
  <div class="questions-section" data-part="1">
    <div class="tfng-question" id="question-1">
      <p class="tfng-statement-text">Statement one.</p>
      <label><input type="radio" name="q1" value="TRUE">True</label>
      <label><input type="radio" name="q1" value="FALSE">False</label>
    </div>
    <p>The gas is <input type="text" name="q2"> in the air.</p>
  </div>
  <script>
    const correctAnswers = { "1": "TRUE", "2": "Oxygen" };
    const questionTypes = { "1": "Quantum Telepathy" };
    function getBand(s){ return s >= 1 ? 9 : 0; }
  </script>
</body></html>`;

describe("parseFullReading — unknown/blank QTYPE попадает под publish-гейт", () => {
  let t: Awaited<ReturnType<typeof parseTest>>;
  beforeAll(async () => {
    t = await parseTest(FULL_UNKNOWN_TYPE_HTML);
  });
  const q = (n: number) => t.questions.find((x) => x.number === n)!;

  it("нераспознанный и пустой label дают gate-распознаваемые warning'и (Q1 unknown, Q2 blank)", () => {
    const unresolved = t.warnings.filter(isUnresolvedQuestionTypeWarning);
    expect(unresolved.some((w) => w.startsWith("Q1:"))).toBe(true);
    expect(unresolved.some((w) => w.startsWith("Q2:"))).toBe(true);
  });

  it("вопросы не теряются: qtype падает на fallback, ключи маршрутизированы", () => {
    expect(q(1).qtype).toBe(UNKNOWN_TYPE_FALLBACK);
    expect(q(2).qtype).toBe(UNKNOWN_TYPE_FALLBACK);
    expect(q(1).answer).toMatchObject({ mode: "exact", accept: ["TRUE"] });
  });
});

// --- реальный образец (skip без gitignored-файла) ---

const FULL_UNGROUPED_MCQ_HTML = `<!doctype html><html><head><title>Full Reading - MCQ</title></head>
<body>
  <section class="passage-section" data-part="1">
    <div class="sectionRubric"><h2>Reading Passage 1</h2></div>
    <div class="passage-content"><p>Body one.</p></div>
  </section>
  <section class="passage-section" data-part="2">
    <div class="sectionRubric"><h2>Reading Passage 2</h2></div>
    <div class="passage-content"><p>Body two.</p></div>
  </section>
  <div class="questions-section" data-part="2">
    <div class="mc-question" id="question-32">
      <div class="mc-statement-wrapper">
        <span class="tfng-number">32</span>
        <div class="tfng-statement-text">What is the writer's main point?</div>
      </div>
      <div class="mc-vertical">
        <label class="mc-radio-label"><input type="radio" name="q32" value="A"> <strong>A</strong> First option.</label>
        <label class="mc-radio-label"><input type="radio" name="q32" value="B"> <strong>B</strong> Second option.</label>
        <label class="mc-radio-label"><input type="radio" name="q32" value="C"> <strong>C</strong> Third option.</label>
      </div>
    </div>
  </div>
  <script>
    const correctAnswers = { "32": "C" };
    const questionTypes = { "32": "Multiple Choice" };
    function getBand(s){ return s >= 1 ? 9 : 0; }
  </script>
</body></html>`;

const FULL_RADIO_CHOOSE_TWO_HTML = `<!doctype html><html><head><title>Full Reading - Choose Two</title></head>
<body>
  <section class="passage-section" data-part="1">
    <div class="sectionRubric"><h2>Reading Passage 1</h2></div>
    <div class="passage-content"><p>Body one.</p></div>
  </section>
  <section class="passage-section" data-part="2">
    <div class="sectionRubric"><h2>Reading Passage 2</h2></div>
    <div class="passage-content"><p>Body two.</p></div>
  </section>
  <div class="questions-section" data-part="2">
    <div class="question">
      <div class="question-rubric">
        <h3>Questions 21 and 22</h3>
        <p>Choose <strong>TWO</strong> letters, <strong>A-E</strong>.</p>
        <p>Which TWO reasons are given?</p>
      </div>
      <div class="question-content">
        <div class="mc-question" id="question-21">
          <div class="mc-statement-wrapper">
            <span class="tfng-number">21</span>
            <div class="tfng-statement-text">First answer</div>
          </div>
          <div class="mc-vertical">
            <label class="mc-radio-label"><input type="radio" name="q21" value="A"> A Alpha.</label>
            <label class="mc-radio-label"><input type="radio" name="q21" value="B"> B Beta.</label>
            <label class="mc-radio-label"><input type="radio" name="q21" value="C"> C Gamma.</label>
          </div>
        </div>
        <div class="mc-question" id="question-22">
          <div class="mc-statement-wrapper">
            <span class="tfng-number">22</span>
            <div class="tfng-statement-text">Second answer</div>
          </div>
          <div class="mc-vertical">
            <label class="mc-radio-label"><input type="radio" name="q22" value="A"> A Alpha.</label>
            <label class="mc-radio-label"><input type="radio" name="q22" value="B"> B Beta.</label>
            <label class="mc-radio-label"><input type="radio" name="q22" value="C"> C Gamma.</label>
          </div>
        </div>
      </div>
    </div>
  </div>
  <script>
    const correctAnswers = { "21": "A", "22": "C" };
    const acceptableVariants = { "21": ["A", "C"], "22": ["A", "C"] };
    const questionTypes = { "21": "Multiple Choice (Two Answers)", "22": "Multiple Choice (Two Answers)" };
    function getBand(s){ return s >= 2 ? 9 : 0; }
  </script>
</body></html>`;

const FULL_ONE_PAGE_HTML = `<!doctype html><html><head><title>Cambridge Style Full Reading</title></head>
<body>
  <section class="passage-container">
    <div id="passageContent">
      <div class="passage-part active" data-part="1"><div class="sectionRubric"><h2>Reading Passage 1</h2></div><h1>One</h1><p>Body one.</p></div>
      <div class="passage-part" data-part="2"><div class="sectionRubric"><h2>Reading Passage 2</h2></div><h1>Two</h1><p>Body two.</p></div>
      <div class="passage-part" data-part="3"><div class="sectionRubric"><h2>Reading Passage 3</h2></div><h1>Three</h1><p>Body three.</p></div>
    </div>
  </section>
  <section class="questions-container">
    <div class="questions-part active" data-part="1">
      <div class="question" id="question-group-1">
        <p>The animal is <span id="question-1" class="blank-wrapper"><input type="text" name="q1"><span class="cdi-placeholder">1</span></span>.</p>
      </div>
    </div>
    <div class="questions-part" data-part="2">
      <div class="tfng-question" id="question-14">
        <p class="tfng-statement-text">Statement fourteen.</p>
        <label><input type="radio" name="q14" value="TRUE">True</label>
        <label><input type="radio" name="q14" value="FALSE">False</label>
      </div>
    </div>
    <div class="questions-part" data-part="3">
      <div class="mcq-block" id="question-27">
        <div class="mcq-stem-row"><span class="mcq-q-num-box">27</span><p class="mcq-stem">What is the writer doing?</p></div>
        <div class="mcq-single">
          <label class="mcq-row"><input type="radio" name="q27" value="A"><span class="mcq-letter">A</span><span>Predicting.</span></label>
          <label class="mcq-row"><input type="radio" name="q27" value="B"><span class="mcq-letter">B</span><span>Describing.</span></label>
        </div>
      </div>
    </div>
  </section>
  <script>
    const correctAnswers = { "1": "rats", "14": "TRUE", "27": "B" };
    const acceptableAnswers = { "1": ["rats", "rat"] };
    const questionTypes = { "1": "Table Completion", "14": "TRUE / FALSE / NOT GIVEN", "27": "Multiple Choice" };
    function getBandFor40(s){ return s >= 3 ? 9 : 0; }
  </script>
</body></html>`;

describe("parseFullReading gap fixtures", () => {
  it("atomizes ungrouped .mc-question radio MCQ blocks", async () => {
    const t = await parseTest(FULL_UNGROUPED_MCQ_HTML);
    const q32 = t.questions.find((q) => q.number === 32)!;

    expect(t.category).toBe("full_reading");
    expect(q32.passageOrder).toBe(2);
    expect(q32.qtype).toBe("mcq_single");
    expect(q32.promptHtml).toBe("What is the writer's main point?");
    expect(q32.options).toHaveLength(3);
    expect(q32.answer).toMatchObject({ mode: "exact", accept: ["C"] });
    expect(t.warnings).toHaveLength(0);
  });

  it("maps radio-rendered choose-TWO MCQ pairs to mcq_multi", async () => {
    const t = await parseTest(FULL_RADIO_CHOOSE_TWO_HTML);
    const q21 = t.questions.find((q) => q.number === 21)!;
    const q22 = t.questions.find((q) => q.number === 22)!;

    expect(q21.qtype).toBe("mcq_multi");
    expect(q22.qtype).toBe("mcq_multi");
    expect(q21.groupKey).toBe("21-22");
    expect(q21.promptHtml).toBe("Which TWO reasons are given?");
    expect(q21.answer).toMatchObject({ mode: "mcq_set", accept: ["A", "C"] });
    expect(q22.answer.mode).toBe("mcq_set");
    expect(t.warnings).toHaveLength(0);
  });

  it("routes one-page .passage-part full reading through the full parser", async () => {
    const t = await parseTest(FULL_ONE_PAGE_HTML);

    expect(t.category).toBe("full_reading");
    expect(t.passages).toHaveLength(3);
    expect(t.passages.every((p) => p.bodyHtml.trim().length > 0)).toBe(true);
    expect(t.questions.map((q) => q.passageOrder)).toEqual([1, 2, 3]);
    expect(t.questions.every((q) => q.promptHtml.trim().length > 0)).toBe(true);
    expect(t.questions.find((q) => q.number === 1)?.answer).toMatchObject({
      mode: "text_accept",
      accept: ["rats", "rat"],
    });
    expect(t.bandScale).not.toBeNull();
    expect(t.warnings).toHaveLength(0);
  });
});

const fullTemplate = sample("Full Test Template.html");
describe.skipIf(!fullTemplate)("real sample — Full Test Template (40Q / 3 passages)", () => {
  it("3 пассажа / 40 вопросов с band-шкалой, каждый вопрос с ключом", async () => {
    const t = await parseTest(fullTemplate!);
    expect(t.section).toBe("reading");
    expect(t.category).toBe("full_reading");
    expect(t.passages).toHaveLength(3);
    expect(t.questions).toHaveLength(40);
    expect(t.durationSeconds).toBe(3600);
    expect(t.bandScale).not.toBeNull();
    expect(Object.keys(t.bandScale!)).toHaveLength(41);
    expect(t.warnings).toHaveLength(0);
    expect(t.questions.every((x) => x.answer.accept.length > 0)).toBe(true);
    expect(t.questionTypes).toEqual(
      expect.arrayContaining(["tfng", "mcq_multi", "matching_features"]),
    );
  });
});

// Inspera Style (окончательный клиентский формат, 2026-07-21): passageContent-обёртка
// вместо .passage-content; standalone .mcq-single с .mcq-stem/.mcq-row (без .mcq-block);
// heading-drop без .drop-value/data-section (paragraph выводится из id heading-line-*);
// ending-line с ведущим .q-num-box; band делегируется getBandFor40 -> getBandFor13.
const INSPERA_HTML = `<!doctype html><html><head><title>Full Reading - Inspera Style</title></head>
<body>
  <div class="sectionRubric" id="globalRubric"><h2>Part 1</h2><p>Read the text.</p></div>
  <section class="passage-section" data-part="1">
    <div id="passageContent-p1" class="passageContent">
      <h1>Passage One Title</h1>
      <div class="paragraph-block">
        <div class="heading-drop-line" id="heading-line-A"><div class="heading-drop" id="drop-q1" data-q="1"><span class="placeholder">1</span></div></div>
        <p id="para-A"><strong>A</strong> Para A body text.</p>
      </div>
      <div class="paragraph-block">
        <div class="heading-drop-line" id="heading-line-B"><div class="heading-drop" id="drop-q2" data-q="2"><span class="placeholder">2</span></div></div>
        <p id="para-B"><strong>B</strong> Para B body text.</p>
      </div>
    </div>
  </section>
  <section class="passage-section" data-part="2">
    <div id="passageContent-p2" class="passageContent">
      <h1>Passage Two Title</h1>
      <p id="pp">Passage two body text.</p>
    </div>
  </section>

  <div class="questions-section" data-part="1">
    <div class="question" id="question-group-1-2">
      <div class="question-rubric"><h3>Questions 1–2</h3><p>Choose the correct heading for each paragraph.</p></div>
      <div class="heading-bank" id="heading-bank">
        <h4 class="heading-bank-title">List of Headings</h4>
        <div class="heading-slot" data-heading="i"><div class="heading-token" draggable="true" data-heading="i"><span>i</span> First heading</div></div>
        <div class="heading-slot" data-heading="ii"><div class="heading-token" draggable="true" data-heading="ii"><span>ii</span> Second heading</div></div>
      </div>
    </div>
  </div>

  <div class="questions-section" data-part="2">
    <div class="question" id="question-group-3-4">
      <div class="question-rubric"><h3>Questions 3–4</h3><p>Choose the correct letter, A, B, C or D.</p></div>
      <div class="question-content">
        <div class="mcq-single" id="question-3">
          <div class="mcq-head"><span class="q-num-box">3</span><div class="mcq-stem">Why did the writer choose this topic?</div></div>
          <div class="mcq-options">
            <label class="mcq-row"><input type="radio" name="q3" value="A"><span class="mcq-letter">A</span><span>First reason.</span></label>
            <label class="mcq-row"><input type="radio" name="q3" value="B"><span class="mcq-letter">B</span><span>Second reason.</span></label>
          </div>
        </div>
        <div class="mcq-single" id="question-4">
          <div class="mcq-head"><span class="q-num-box">4</span><div class="mcq-stem">What is the main argument?</div></div>
          <div class="mcq-options">
            <label class="mcq-row"><input type="radio" name="q4" value="A"><span class="mcq-letter">A</span><span>Alpha.</span></label>
            <label class="mcq-row"><input type="radio" name="q4" value="B"><span class="mcq-letter">B</span><span>Beta.</span></label>
          </div>
        </div>
      </div>
    </div>
    <div class="question" id="question-group-5-6">
      <div class="question-rubric"><h3>Questions 5–6</h3><p>Complete each sentence with the correct ending.</p></div>
      <div class="question-content">
        <div class="ending-line" id="question-5">
          <span class="q-num-box">5</span>
          <span class="ending-stmt">The first statement stem</span>
          <div class="ending-drop" id="drop-q5" data-q="5"><span class="placeholder">A–F</span></div>
        </div>
        <div class="ending-line" id="question-6">
          <span class="q-num-box">6</span>
          <span class="ending-stmt">The second statement stem</span>
          <div class="ending-drop" id="drop-q6" data-q="6"><span class="placeholder">A–F</span></div>
        </div>
        <div class="ending-bank" id="ending-bank">
          <h4 class="ending-bank-title">List of Endings</h4>
          <div class="ending-slot" data-ending="A"><div class="ending-token" draggable="true" data-ending="A"><b>A</b> ending one.</div></div>
          <div class="ending-slot" data-ending="B"><div class="ending-token" draggable="true" data-ending="B"><b>B</b> ending two.</div></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const correctAnswers = { "1":"i","2":"ii","3":"A","4":"B","5":"A","6":"B" };
    const questionTypes = { "1":"Matching Headings","2":"Matching Headings","3":"Multiple Choice","4":"Multiple Choice","5":"Sentence Endings","6":"Sentence Endings" };
    function getBandFor13(s){ if(s>=6) return 9; if(s>=3) return 5; return 0; }
    function getBandFor40(s){ return getBandFor13(s); }
  </script>
</body></html>`;

describe("parseFullReading — Inspera Style фикстура", () => {
  let t: Awaited<ReturnType<typeof parseTest>>;
  beforeAll(async () => {
    t = await parseTest(INSPERA_HTML);
  });
  const q = (n: number) => t.questions.find((x) => x.number === n)!;

  it("fix 1: band делегируется getBandFor40 -> getBandFor13 и материализуется 0..40", () => {
    expect(t.bandScale).not.toBeNull();
    expect(Object.keys(t.bandScale!)).toHaveLength(41);
    expect(t.bandScale!["40"]).toBe(9);
    expect(t.bandScale!["0"]).toBe(0);
  });

  it("fix 2: standalone .mcq-single атомизируется с .mcq-stem prompt и options", () => {
    expect(q(3).qtype).toBe("mcq_single");
    expect(q(3).promptHtml).toBe("Why did the writer choose this topic?");
    expect(q(3).options).toHaveLength(2);
    expect(q(3).options!.every((o) => o.value && o.label.trim())).toBe(true);
    expect(q(4).promptHtml).toBe("What is the main argument?");
    expect(q(4).options).toHaveLength(2);
  });

  it("fix 3: matching-headings prompt = Paragraph <буква> из id heading-line-*", () => {
    expect(q(1).promptHtml).toBe("Paragraph A");
    expect(q(2).promptHtml).toBe("Paragraph B");
    expect(q(1).options).toHaveLength(2);
  });

  it("fix 4: ending prompt без ведущего .q-num-box", () => {
    expect(q(5).promptHtml).toBe("The first statement stem");
    expect(q(6).promptHtml).toBe("The second statement stem");
  });

  it("fix 5: bodyHtml берётся из .passageContent, без обёртки-секции", () => {
    expect(t.passages).toHaveLength(2);
    expect(t.passages[0].bodyHtml).toContain("Para A body text");
    expect(t.passages[0].bodyHtml).not.toContain("passageContent");
  });
});

// Регресс 2026-07-21: band-цепочка не должна подхватывать САМОСТОЯТЕЛЬНУЮ getBandFor13
// (13-вопросную шкалу) без делегирующего getBandFor40 — иначе legacy-функция ложно
// материализуется как 0..40-таблица. Фолбэк на getBandFor13 законен только при
// доказанном делегировании (getBandFor40, чьё тело ссылается на getBandFor13).
const FULL_STANDALONE_G13_HTML = `<!doctype html><html><head><title>Full Reading - Standalone G13</title></head>
<body>
  <section class="passage-section" data-part="1">
    <div class="sectionRubric"><h2>Reading Passage 1</h2></div>
    <div class="passage-content"><p>Body one.</p></div>
  </section>
  <section class="passage-section" data-part="2">
    <div class="sectionRubric"><h2>Reading Passage 2</h2></div>
    <div class="passage-content"><p>Body two.</p></div>
  </section>
  <div class="questions-section" data-part="1">
    <div class="tfng-question" id="question-1">
      <p class="tfng-statement-text">Statement one.</p>
      <label><input type="radio" name="q1" value="TRUE">True</label>
      <label><input type="radio" name="q1" value="FALSE">False</label>
    </div>
  </div>
  <script>
    const correctAnswers = { "1": "TRUE" };
    const questionTypes = { "1": "True/False/Not Given" };
    function getBandFor13(s){ if(s>=13) return 9.0; if(s>=6) return 5.5; return 0; }
  </script>
</body></html>`;

describe("parseFullReading — standalone getBandFor13 без делегата → нет band-шкалы", () => {
  it("bandScale null + warning про отсутствующий getBand", async () => {
    const t = await parseTest(FULL_STANDALONE_G13_HTML);
    expect(t.bandScale).toBeNull();
    expect(t.warnings.some((w) => /getBand function not found/i.test(w))).toBe(true);
  });
});

// Дефект текстового гейта (ревью 2026-07-21): многострочный делегатор getBandFor40 с
// вложенным if{} до вызова getBandFor13. Старый non-greedy regex обрывался на внутренней
// `}` → getBandFor13 не виден → delegates=false → шкала терялась. Со-определение в vm
// вызывает делегатор целиком → шкала 0..40 извлекается.
const FULL_MULTILINE_DELEGATE_HTML = FULL_STANDALONE_G13_HTML.replace(
  "function getBandFor13(s){ if(s>=13) return 9.0; if(s>=6) return 5.5; return 0; }",
  "function getBandFor13(s){ if(s>=1) return 9.0; return 0; }\n" +
    "    function getBandFor40(s){ if (s < 0) { return null; } return getBandFor13(s); }",
);

describe("parseFullReading — многострочный делегатор getBandFor40 -> getBandFor13", () => {
  it("шкала 0..40 извлекается несмотря на вложенный if{} до вызова", async () => {
    const t = await parseTest(FULL_MULTILINE_DELEGATE_HTML);
    expect(t.bandScale).not.toBeNull();
    expect(Object.keys(t.bandScale!)).toHaveLength(41);
    expect(t.bandScale!["40"]).toBe(9);
  });
});

// Роутинг-регресс (review 2026-07-17): isListening() расширили с `.part[data-part]`
// на bare `.part`, чтобы malformed listening-файлы тоже доходили до parse-listening
// (см. parse-listening.test.ts). Full Reading использует `.passage-section`/
// `.questions-section` — другие CSS-классы, не литеральный `.part` — так что
// расширение его не задевает; adversarial-вариант (+ случайный <audio>) доказывает
// это явно, а не полагается на отсутствие <audio> в фикстуре как на случайность.
describe("isListening routing regression — full reading остаётся reading", () => {
  it("adversarial: FULL_HTML + случайный <audio> без .part — остаётся full_reading, не listening", async () => {
    const html = FULL_HTML.replace("<body>", '<body><audio src="unrelated.mp3"></audio>');
    const t = await parseTest(html);
    expect(t.section).toBe("reading");
    expect(t.category).toBe("full_reading");
    expect(t.passages).toHaveLength(2);
  });
});

// --- Inspera Style golden fixture (committed, 2026-07-21) ---
// Синтетический мини-тест канонического клиентского формата: 3 пассажа, 16 вопросов
// непрерывной нумерации 1..16, 8 типов ×2 (TFNG / note / matching-headings / matching-
// info / summary / MCQ-single standalone / sentence-endings / YNNG). Интегральная
// проверка ВСЕГО committed-файла: атомизация каждого типа + merge + анти-утечка capture.
const INSPERA_GOLDEN = readFileSync(
  fileURLToPath(new URL("./runner/fixtures/reading-inspera.html", import.meta.url)),
  "utf8",
);

describe("Inspera golden fixture — parseFullReading (committed file)", () => {
  let t: Awaited<ReturnType<typeof parseTest>>;
  beforeAll(async () => {
    t = await parseTest(INSPERA_GOLDEN);
  });
  const q = (n: number) => t.questions.find((x) => x.number === n)!;

  it("3 пассажа, 16/16 атомизировано, у каждого вопроса непустой prompt (>3 символов)", () => {
    expect(t.section).toBe("reading");
    expect(t.category).toBe("full_reading");
    expect(t.passages).toHaveLength(3);
    expect(t.questions.map((x) => x.number)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(t.questions.every((x) => x.promptHtml.trim().length > 3)).toBe(true);
  });

  it("вопросы разложены по пассажам через [data-part] (1..3)", () => {
    expect([q(1).passageOrder, q(3).passageOrder]).toEqual([1, 1]);
    expect([q(5).passageOrder, q(7).passageOrder, q(9).passageOrder]).toEqual([2, 2, 2]);
    expect([q(11).passageOrder, q(13).passageOrder, q(15).passageOrder]).toEqual([3, 3, 3]);
  });

  it("MCQ-single атомизируется с options; headings prompt = Paragraph <буква>", () => {
    expect(q(11).qtype).toBe("mcq_single");
    expect(q(11).options).toHaveLength(4);
    expect(q(11).options!.every((o) => o.value && o.label.trim())).toBe(true);
    expect(q(11).promptHtml).toMatch(/plateau survive/i);
    expect(q(5).promptHtml).toBe("Paragraph A");
    expect(q(6).promptHtml).toBe("Paragraph B");
    expect(q(5).options!.length).toBeGreaterThanOrEqual(2);
    // sentence-ending prompt очищен от ведущего .q-num-box
    expect(q(13).promptHtml).toBe("Plants with thick stems on the plateau");
    expect(q(13).options!.length).toBeGreaterThanOrEqual(2);
  });

  it("qtype каждого типа канонизирован", () => {
    expect(q(1).qtype).toBe("tfng");
    expect(q(3).qtype).toBe("note_completion");
    expect(q(5).qtype).toBe("matching_headings");
    expect(q(7).qtype).toBe("matching_info");
    expect(q(9).qtype).toBe("summary_completion");
    expect(q(12).qtype).toBe("mcq_single");
    expect(q(14).qtype).toBe("matching_sentence_endings");
    expect(q(16).qtype).toBe("ynng");
  });

  it("mergeAtomization: множества номеров совпадают → atomized=true, prompt из atom", async () => {
    const runner = (await parseRunner(INSPERA_GOLDEN)).parsed;
    const merged = mergeAtomization(runner, t);
    expect(merged.atomized).toBe(true);
    expect(merged.parsed.questions).toHaveLength(16);
    expect(merged.parsed.questions.every((x) => x.promptHtml.trim().length > 3)).toBe(true);
    // ключ неприкосновенен — из runner
    expect(merged.parsed.questions.find((x) => x.number === 3)!.answer.accept).toEqual([
      "lanterns",
      "lantern",
    ]);
  });

  // Анти-утечка (BRIEF §6.1): verbatim-захват вопрос-панели обязан вырезать .analysis-дивы
  // (несут ответ в тексте, скрыты лишь CSS, который capture не переносит на клиент).
  it("questionsHtml capture не содержит .analysis и синтетических ответов фикстуры", () => {
    const captured = t.passages
      .map((p) => p.questionsHtml)
      .filter((h): h is string => h != null)
      .join("\n");
    expect(captured.length).toBeGreaterThan(0);
    expect(captured).not.toMatch(/analysis/i);
    for (const word of ["lanterns", "copper", "harbour", "ledger"]) {
      expect(captured.toLowerCase()).not.toContain(word);
    }
  });
});
