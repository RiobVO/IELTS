// Тесты single-passage парсера (BRIEF §4.2). Inline-фикстура повторяет селекторы
// parse-test.ts и формы JS-объектов из его контракта (не выдуманная разметка).
// + блок skipIf на реальном samples/ (регрессия локально, скип в CI).
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTest } from "./parse-test";

const sample = (name: string): string | null => {
  const p = fileURLToPath(new URL(`../../../samples/${name}`, import.meta.url));
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

const SINGLE_HTML = `<!doctype html><html><head><title>Reading - Sample</title></head>
<body>
  <div class="sectionRubric">Reading Passage 2. You should spend about 20 minutes on the Questions.</div>
  <div id="passageContent">
    <h1>Mountain Parks</h1>
    <p>Safe passage text.</p>
    <script>window.evil = 1;</script>
    <p onclick="steal()">Handler paragraph.</p>
    <a href="javascript:alert(1)">bad link</a>
  </div>

  <div class="tfng-question" id="question-1">
    <p class="tfng-statement-text">Statement one is true.</p>
    <label><input type="radio" name="q1" value="TRUE">True</label>
    <label><input type="radio" name="q1" value="FALSE">False</label>
    <label><input type="radio" name="q1" value="NOT GIVEN">Not Given</label>
  </div>
  <div class="tfng-question" id="question-2">
    <p class="tfng-statement-text">Statement two.</p>
    <label><input type="radio" name="q2" value="TRUE">True</label>
    <label><input type="radio" name="q2" value="FALSE">False</label>
  </div>

  <div id="question-3" class="question">
    <p>The animal needs a <input type="text" name="q3"> to survive.</p>
  </div>

  <div class="question" id="question-4">
    <div class="question-rubric"><p>Choose TWO letters.</p></div>
    <div class="mcq-block" data-mcq-group="4-5">
      <span class="mcq-q-num-box">4</span>
      <span class="mcq-q-num-box">5</span>
      <div class="mcq-row"><input type="checkbox" value="A"><span>Alpha</span></div>
      <div class="mcq-row"><input type="checkbox" value="B"><span>Beta</span></div>
      <div class="mcq-row"><input type="checkbox" value="C"><span>Gamma</span></div>
    </div>
  </div>

  <script>
    const correctAnswers = { "1": "TRUE", "3": "Habitat" };
    const acceptableAnswers = { "2": ["FALSE"] };
    const mcqGroups = { "4-5": { qs: [4, 5], correct: ["A", "C"] } };
    const questionTypes = { "1": "True/False/Not Given", "2": "True/False/Not Given", "3": "Note Completion" };
  </script>
</body></html>`;

describe("parseTest — single passage", () => {
  const t = parseTest(SINGLE_HTML);
  const q = (n: number) => t.questions.find((x) => x.number === n)!;

  it("диспетчеризуется в single-passage и читает мету из рубрики", () => {
    expect(t.section).toBe("reading");
    expect(t.category).toBe("passage_2");
    expect(t.durationSeconds).toBe(1200); // "spend about 20 minutes" -> 20*60
    expect(t.bandScale).toBeNull(); // одиночный пассаж — percent, не band
    expect(t.passages).toHaveLength(1);
  });

  it("санитайзит пассаж: убирает script/обработчики/javascript: ссылки", () => {
    const body = t.passages[0].bodyHtml;
    expect(body).toContain("Safe passage text");
    expect(body).not.toContain("window.evil");
    expect(body).not.toContain("onclick");
    expect(body).not.toContain("javascript:");
  });

  it("маршрутизирует ключ по режимам: exact / text_accept / mcq_set", () => {
    expect(q(1).answer).toMatchObject({ mode: "exact", accept: ["TRUE"] });
    expect(q(2).answer).toMatchObject({ mode: "text_accept", accept: ["FALSE"] });
    expect(q(4).answer).toMatchObject({ mode: "mcq_set", accept: ["A", "C"] });
    expect(q(5).answer.mode).toBe("mcq_set");
  });

  it("нормализует exact-ответ (trim/upper)", () => {
    expect(q(3).answer.accept).toEqual(["HABITAT"]); // из "Habitat"
  });

  it("назначает канон-типы и не плодит предупреждений на чистом входе", () => {
    expect(q(1).qtype).toBe("tfng");
    expect(q(3).qtype).toBe("note_completion");
    expect(q(4).qtype).toBe("mcq_multi");
    expect(t.questionTypes).toEqual(
      expect.arrayContaining(["tfng", "note_completion", "mcq_multi"]),
    );
    expect(t.warnings).toHaveLength(0);
  });
});

// --- реальные образцы (skip, если gitignored-файла нет: чистый клон / CI) ---

const DD_BLANK_HTML = `<!doctype html><html><head><title>Reading - Drag</title></head>
<body>
  <div class="sectionRubric">Reading Passage 3. You should spend about 20 minutes on the Questions.</div>
  <div id="passageContent"><h1>Drag Summary</h1><p>Passage text.</p></div>
  <div class="question" id="question-group-31-32">
    <div class="question-rubric"><p>Complete the summary using the list of words below.</p></div>
    <div class="question-content">
      <p class="notes-item">Sugar depended on <span class="blank-wrapper"><span class="dd-blank" id="question-31" data-q="31"><span class="placeholder">31</span></span><button class="review-flag" data-q="31"></button></span>.</p>
      <p class="notes-item">Traditional methods <span class="blank-wrapper"><span class="dd-blank" id="question-32" data-q="32"><span class="placeholder">32</span></span><button class="review-flag" data-q="32"></button></span> continued.</p>
    </div>
  </div>
  <script>
    const correctAnswers = { "31": "H", "32": "E" };
    const acceptableAnswers = {};
    const mcqGroups = {};
    const questionTypes = { "31": "Summary Completion", "32": "Summary Completion" };
  </script>
</body></html>`;

describe("parseTest gap fixtures", () => {
  it("atomizes drag-and-drop completion blanks rendered as .dd-blank spans", () => {
    const t = parseTest(DD_BLANK_HTML);
    const q31 = t.questions.find((q) => q.number === 31)!;

    expect(t.questions).toHaveLength(2);
    expect(q31.qtype).toBe("summary_completion");
    expect(q31.promptHtml).toBe("Sugar depended on ____ .");
    expect(q31.answer).toMatchObject({ mode: "exact", accept: ["H"] });
    expect(t.warnings).toHaveLength(0);
  });

  it("uses .stmt-text as the prompt for matching-table rows", () => {
    const html = `<!doctype html><html><head><title>Reading - Matching</title></head>
    <body>
      <div class="sectionRubric">Reading Passage 2. You should spend about 20 minutes on the Questions.</div>
      <div id="passageContent"><h1>Quiet Places</h1><p>Passage text.</p></div>
      <div class="question" id="question-group-14">
        <table class="matching-table">
          <tr id="question-14">
            <td class="statement-cell"><span class="match-num">14</span><span class="stmt-text">examples of strategies to decrease noise</span></td>
            <td><input type="radio" name="q14" value="A"></td>
            <td><input type="radio" name="q14" value="B"></td>
          </tr>
        </table>
      </div>
      <script>
        const correctAnswers = { "14": "A" };
        const acceptableAnswers = {};
        const mcqGroups = {};
        const questionTypes = { "14": "Matching Information" };
      </script>
    </body></html>`;
    const t = parseTest(html);
    const q14 = t.questions.find((q) => q.number === 14)!;

    expect(q14.promptHtml).toBe("examples of strategies to decrease noise");
    expect(q14.qtype).toBe("matching_info");
    expect(q14.answer).toMatchObject({ mode: "exact", accept: ["A"] });
    expect(t.warnings).toHaveLength(0);
  });
});

const tuatara = sample("P3 Tuatara.html");
describe.skipIf(!tuatara)("real sample — P3 Tuatara", () => {
  it("чисто разбирает 14 вопросов, каждый с ключом, без band-шкалы", () => {
    const t = parseTest(tuatara!);
    expect(t.section).toBe("reading");
    expect(t.category).toBe("passage_3");
    expect(t.passages).toHaveLength(1);
    expect(t.questions).toHaveLength(14);
    expect(t.bandScale).toBeNull();
    expect(t.warnings).toHaveLength(0);
    expect(t.questions.every((x) => x.answer.accept.length > 0)).toBe(true);
    expect(t.questionTypes).toEqual(
      expect.arrayContaining(["ynng", "mcq_single", "summary_completion"]),
    );
  });
});

const banff = sample("Banff National Park.html");
describe.skipIf(!banff)("real sample — Banff National Park (MCQ)", () => {
  it("разбирает MCQ-файл: 13 вопросов, есть mcq_set, нет unknown-type", () => {
    const t = parseTest(banff!);
    expect(t.questions).toHaveLength(13);
    expect(t.questionTypes).toEqual(expect.arrayContaining(["mcq_single", "mcq_multi"]));
    expect(t.questions.some((x) => x.answer.mode === "mcq_set")).toBe(true);
    expect(t.warnings.some((w) => /unknown question type/i.test(w))).toBe(false);
  });
});
