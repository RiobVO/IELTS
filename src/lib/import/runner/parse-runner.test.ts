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

describe("parseRunner — listening qtype", () => {
  const r = parseRunner(listening);
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
  const w = parseRunner(readingWithIssues).parsed.warnings;
  it("флагует неизвестный тип с фоллбэком на short_answer", () => {
    expect(w.some((x) => /Q2/.test(x) && /short_answer/i.test(x))).toBe(true);
  });
  it("флагует низко-уверенный (fuzzy) тип", () => {
    expect(w.some((x) => /Q3/.test(x) && /matching_info/.test(x))).toBe(true);
  });
  it("флагует пустой ключ", () => {
    expect(w.some((x) => /Q2/.test(x) && /key/i.test(x))).toBe(true);
  });
  it("чистый файл: нет unknown-type / empty-key warnings", () => {
    const clean = parseRunner(reading).parsed.warnings;
    expect(clean.some((x) => /unknown type|empty answer key/i.test(x))).toBe(false);
  });
});
