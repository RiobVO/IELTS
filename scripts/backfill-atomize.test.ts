import { describe, it, expect } from "vitest";
import {
  checkQuestionNumberGate,
  planPassages,
  findQtypeMismatches,
  hasMapLabelling,
  selectQtypeFixes,
  parserLabel,
  type QtypeMismatch,
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

describe("hasMapLabelling", () => {
  it("есть вопрос qtype=map_labelling -> true", () => {
    expect(hasMapLabelling([{ qtype: "mcq_single" }, { qtype: "map_labelling" }])).toBe(true);
  });

  it("нет map_labelling -> false", () => {
    expect(hasMapLabelling([{ qtype: "mcq_single" }, { qtype: "tfng" }])).toBe(false);
  });

  it("пустой список вопросов -> false", () => {
    expect(hasMapLabelling([])).toBe(false);
  });
});

describe("selectQtypeFixes", () => {
  it("listening: промоутит только mcq_single -> mcq_multi, остальное не трогает", () => {
    const mismatches: QtypeMismatch[] = [
      { number: 1, dbQtype: "mcq_single", parsedQtype: "mcq_multi" },
      { number: 2, dbQtype: "map_labelling", parsedQtype: "mcq_single" },
      { number: 3, dbQtype: "matching_info", parsedQtype: "matching_features" },
    ];
    expect(selectQtypeFixes("listening", mismatches, false)).toEqual([1]);
  });

  it("listening: parsed=mcq_multi при db!=mcq_single НЕ промоутится (обе стороны пары обязаны совпасть)", () => {
    const mismatches: QtypeMismatch[] = [
      { number: 7, dbQtype: "matching_features", parsedQtype: "mcq_multi" },
    ];
    expect(selectQtypeFixes("listening", mismatches, false)).toEqual([]);
  });

  it("listening: --fix-qtype флаг не участвует в решении (промоушен применяется независимо от него)", () => {
    const mismatches: QtypeMismatch[] = [
      { number: 1, dbQtype: "mcq_single", parsedQtype: "mcq_multi" },
      { number: 2, dbQtype: "matching_info", parsedQtype: "matching_features" },
    ];
    expect(selectQtypeFixes("listening", mismatches, true)).toEqual([1]);
  });

  it("reading: без --fix-qtype ничего не применяется", () => {
    const mismatches: QtypeMismatch[] = [{ number: 1, dbQtype: "unknown", parsedQtype: "note_completion" }];
    expect(selectQtypeFixes("reading", mismatches, false)).toEqual([]);
  });

  it("reading: с --fix-qtype применяются ВСЕ расхождения", () => {
    const mismatches: QtypeMismatch[] = [
      { number: 1, dbQtype: "unknown", parsedQtype: "note_completion" },
      { number: 2, dbQtype: "mcq_single", parsedQtype: "mcq_multi" },
    ];
    expect(selectQtypeFixes("reading", mismatches, true)).toEqual([1, 2]);
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
