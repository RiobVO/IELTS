// Тесты Full-Reading парсера (BRIEF §4.2). Inline-фикстура повторяет селекторы
// parse-reading-full.ts; маршрут через диспетчер parseTest (≥2 .passage-section).
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTest } from "./parse-test";
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
