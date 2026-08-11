import { describe, it, expect } from "vitest";
import {
  checkQuestionNumberGate,
  planPassages,
  findQtypeMismatches,
  parserLabel,
} from "./backfill-atomize";

describe("checkQuestionNumberGate", () => {
  it("совпадающие множества -> ok, все списки пусты", () => {
    const r = checkQuestionNumberGate([1, 2, 3], [3, 2, 1]);
    expect(r).toEqual({ ok: true, missing: [], extra: [], duplicates: [] });
  });

  it("парсер нашёл вопрос, которого нет в БД -> missing, не ok", () => {
    const r = checkQuestionNumberGate([1, 2, 3], [1, 2]);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([3]);
    expect(r.extra).toEqual([]);
  });

  it("в БД есть вопрос, которого парсер не нашёл -> extra, не ok", () => {
    const r = checkQuestionNumberGate([1, 2], [1, 2, 3]);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([3]);
  });

  it("одинаковый размер, но разные номера -> и missing, и extra", () => {
    const r = checkQuestionNumberGate([1, 2, 4], [1, 2, 3]);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([4]);
    expect(r.extra).toEqual([3]);
  });

  it("дубликаты в распарсенных номерах валят гейт (update по number перезаписал бы строку многократно)", () => {
    const r = checkQuestionNumberGate([1, 1, 2], [1, 2]);
    expect(r.ok).toBe(false);
    expect(r.duplicates).toEqual([1]);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
  });
});

describe("planPassages", () => {
  it("order отсутствует в БД -> insert", () => {
    const plan = planPassages([1, 2, 3], [{ id: "p1", order: 1, bodyHtml: "<p>x</p>" }]);
    expect(plan).toEqual([
      { order: 1, action: "skip-has-content", passageId: "p1" },
      { order: 2, action: "insert" },
      { order: 3, action: "insert" },
    ]);
  });

  it("order есть, body_html пуст -> update", () => {
    const plan = planPassages([1], [{ id: "p1", order: 1, bodyHtml: "" }]);
    expect(plan).toEqual([{ order: 1, action: "update", passageId: "p1" }]);
  });

  it("order есть, body_html NULL -> update (защита от NULL, не только пустой строки)", () => {
    const plan = planPassages([1], [{ id: "p1", order: 1, bodyHtml: null }]);
    expect(plan).toEqual([{ order: 1, action: "update", passageId: "p1" }]);
  });

  it("order есть, body_html — пробелы -> update (trim, не считается контентом)", () => {
    const plan = planPassages([1], [{ id: "p1", order: 1, bodyHtml: "   \n  " }]);
    expect(plan).toEqual([{ order: 1, action: "update", passageId: "p1" }]);
  });

  it("order есть, body_html непуст -> skip-has-content (не затираем ручную правку)", () => {
    const plan = planPassages([1], [{ id: "p1", order: 1, bodyHtml: "<p>Real passage text</p>" }]);
    expect(plan).toEqual([{ order: 1, action: "skip-has-content", passageId: "p1" }]);
  });
});

describe("findQtypeMismatches", () => {
  it("совпадающие qtype -> пустой список", () => {
    const out = findQtypeMismatches(
      [{ number: 1, qtype: "tfng" }],
      [{ number: 1, qtype: "tfng" }],
    );
    expect(out).toEqual([]);
  });

  it("расхождение qtype -> попадает в отчёт с обоими значениями", () => {
    const out = findQtypeMismatches(
      [{ number: 1, qtype: "note_completion" }],
      [{ number: 1, qtype: "unknown" }],
    );
    expect(out).toEqual([{ number: 1, dbQtype: "unknown", parsedQtype: "note_completion" }]);
  });

  it("номер отсутствует в БД -> не попадает в отчёт (это дело гейта, не qtype-сверки)", () => {
    const out = findQtypeMismatches(
      [{ number: 99, qtype: "tfng" }],
      [{ number: 1, qtype: "tfng" }],
    );
    expect(out).toEqual([]);
  });

  it("сортирует расхождения по номеру вопроса", () => {
    const out = findQtypeMismatches(
      [
        { number: 5, qtype: "a" },
        { number: 2, qtype: "b" },
      ],
      [
        { number: 5, qtype: "x" },
        { number: 2, qtype: "y" },
      ],
    );
    expect(out.map((m) => m.number)).toEqual([2, 5]);
  });
});

describe("parserLabel", () => {
  it("listening -> parse-listening", () => {
    expect(parserLabel({ section: "listening", category: "full_listening" })).toMatch(/parse-listening/);
  });

  it("full_reading -> parse-reading-full", () => {
    expect(parserLabel({ section: "reading", category: "full_reading" })).toMatch(/parse-reading-full/);
  });

  it("одиночный пассаж (passage_1/2/3) -> parse-test", () => {
    expect(parserLabel({ section: "reading", category: "passage_1" })).toMatch(/parse-test/);
  });
});
