// Тесты Full-Reading парсера (BRIEF §4.2). Inline-фикстура повторяет селекторы
// parse-reading-full.ts; маршрут через диспетчер parseTest (≥2 .passage-section).
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTest } from "./parse-test";

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
  const t = parseTest(FULL_HTML); // через диспетчер
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

// --- реальный образец (skip без gitignored-файла) ---

const fullTemplate = sample("Full Test Template.html");
describe.skipIf(!fullTemplate)("real sample — Full Test Template (40Q / 3 passages)", () => {
  it("3 пассажа / 40 вопросов с band-шкалой, каждый вопрос с ключом", () => {
    const t = parseTest(fullTemplate!);
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
