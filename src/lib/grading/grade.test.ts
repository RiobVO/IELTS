// Юнит-тесты серверного грейдинга (BRIEF §5.1). Относительный импорт — alias не нужен.
import { describe, it, expect } from "vitest";
import { grade, gradeOne, isCorrect, type GradeKey } from "./grade";

describe("isCorrect", () => {
  describe("mcq_set", () => {
    it("сравнивает ответ как множество: порядок, регистр и разделитель не важны", () => {
      expect(isCorrect("mcq_set", ["A", "C"], ["c", "a"])).toBe(true); // массив, др. порядок + регистр
      expect(isCorrect("mcq_set", ["A", "C"], "c a")).toBe(true); // строка через пробел
      expect(isCorrect("mcq_set", ["A", "C"], "a,c")).toBe(true); // строка через запятую
    });

    it("отклоняет неполный набор", () => {
      expect(isCorrect("mcq_set", ["A", "C"], ["A"])).toBe(false);
    });

    it("отклоняет набор с лишним вариантом (ловит снятие проверки размера)", () => {
      // подмножество {A,C} ⊆ {A,B,C}: только сравнение размеров отсекает лишнее
      expect(isCorrect("mcq_set", ["A", "C"], ["A", "B", "C"])).toBe(false);
    });
  });

  describe("text_accept", () => {
    it("принимает любой вариант после нормализации trim/регистр/схлоп пробелов", () => {
      expect(isCorrect("text_accept", ["New York"], "  new   york ")).toBe(true);
      expect(isCorrect("text_accept", ["color", "colour"], "Colour")).toBe(true);
    });

    it("отклоняет значение, которого нет среди принятых", () => {
      expect(isCorrect("text_accept", ["color", "colour"], "couleur")).toBe(false);
    });
  });

  describe("exact", () => {
    it("нормализует и сравнивает только с accept[0]", () => {
      expect(isCorrect("exact", ["Not Given"], " not  given ")).toBe(true);
    });

    it("отличается от text_accept: проверяет только accept[0], игнорируя остальные", () => {
      // одни и те же данные, разный режим: "Y" — второй принятый вариант
      expect(isCorrect("text_accept", ["X", "Y"], "Y")).toBe(true);
      expect(isCorrect("exact", ["X", "Y"], "Y")).toBe(false);
      expect(isCorrect("exact", ["X", "Y"], "X")).toBe(true);
    });
  });

  it("считает null, undefined, пустую и пробельную строку неверными в любом режиме", () => {
    expect(isCorrect("exact", ["A"], null)).toBe(false);
    expect(isCorrect("exact", ["A"], undefined)).toBe(false);
    expect(isCorrect("text_accept", ["A"], "")).toBe(false);
    expect(isCorrect("text_accept", ["A"], "   ")).toBe(false);
    expect(isCorrect("mcq_set", ["A"], "   ")).toBe(false);
  });
});

// gradeOne — ключ-образный вход единичной проверки (P6 checkAnswer). Делегирует ту
// же логику, что isCorrect; тесты держат контракт всех трёх режимов + нормализацию.
describe("gradeOne", () => {
  it("mcq_set: сверяет как множество (порядок/регистр/разделитель не важны)", () => {
    expect(gradeOne({ mode: "mcq_set", accept: ["A", "C"] }, ["c", "a"])).toBe(true);
    expect(gradeOne({ mode: "mcq_set", accept: ["A", "C"] }, "a,c")).toBe(true);
    expect(gradeOne({ mode: "mcq_set", accept: ["A", "C"] }, ["A"])).toBe(false); // неполный
    expect(gradeOne({ mode: "mcq_set", accept: ["A", "C"] }, ["A", "B", "C"])).toBe(false); // лишний
  });

  it("text_accept: принимает любой вариант после нормализации, иначе отклоняет", () => {
    expect(gradeOne({ mode: "text_accept", accept: ["New York"] }, "  new   york ")).toBe(true);
    expect(gradeOne({ mode: "text_accept", accept: ["color", "colour"] }, "Colour")).toBe(true);
    expect(gradeOne({ mode: "text_accept", accept: ["color", "colour"] }, "couleur")).toBe(false);
  });

  it("exact: нормализует и сверяет ТОЛЬКО с accept[0]", () => {
    expect(gradeOne({ mode: "exact", accept: ["Not Given"] }, " not  given ")).toBe(true);
    expect(gradeOne({ mode: "exact", accept: ["X", "Y"] }, "Y")).toBe(false); // accept[1] игнорируется
    expect(gradeOne({ mode: "exact", accept: ["X", "Y"] }, "X")).toBe(true);
  });

  it("пустой/отсутствующий ответ — неверно в любом режиме", () => {
    expect(gradeOne({ mode: "exact", accept: ["A"] }, null)).toBe(false);
    expect(gradeOne({ mode: "text_accept", accept: ["A"] }, "   ")).toBe(false);
    expect(gradeOne({ mode: "mcq_set", accept: ["A"] }, [])).toBe(false);
  });
});

describe("grade", () => {
  it("считает rawScore верными и включает в total каждый ключ, в т.ч. без ответа", () => {
    const keys: GradeKey[] = [
      { number: 1, qtype: "tfng", mode: "exact", accept: ["TRUE"] },
      { number: 2, qtype: "tfng", mode: "exact", accept: ["FALSE"] },
      { number: 3, qtype: "mcq_single", mode: "exact", accept: ["A"] }, // без ответа
    ];
    const r = grade(keys, { "1": "true", "2": "WRONG" });
    expect(r.rawScore).toBe(1);
    expect(r.total).toBe(3);
  });

  it("агрегирует correct/total по типу вопроса", () => {
    const keys: GradeKey[] = [
      { number: 1, qtype: "tfng", mode: "exact", accept: ["TRUE"] },
      { number: 2, qtype: "tfng", mode: "exact", accept: ["FALSE"] },
      { number: 3, qtype: "mcq_single", mode: "exact", accept: ["B"] },
    ];
    const r = grade(keys, { "1": "true", "2": "true", "3": "b" }); // q2 неверно
    expect(r.perType.tfng).toEqual({ correct: 1, total: 2 });
    expect(r.perType.mcq_single).toEqual({ correct: 1, total: 1 });
  });

  it("округляет percent до ближайшего целого (ловит floor вместо round)", () => {
    const keys: GradeKey[] = [
      { number: 1, qtype: "tfng", mode: "exact", accept: ["TRUE"] },
      { number: 2, qtype: "tfng", mode: "exact", accept: ["TRUE"] },
      { number: 3, qtype: "tfng", mode: "exact", accept: ["TRUE"] },
    ];
    const r = grade(keys, { "1": "true", "2": "true", "3": "false" }); // 2 из 3
    expect(r.rawScore).toBe(2);
    expect(r.percent).toBe(67); // 66.66.. → 67, не 66
  });

  it("пустой набор ключей даёт 0% без деления на ноль", () => {
    const r = grade([], {});
    expect(r.percent).toBe(0);
    expect(r.total).toBe(0);
    expect(r.rawScore).toBe(0);
  });

  it("фиксирует в perQuestion данный ответ и корректность (без ответа → given:null)", () => {
    const keys: GradeKey[] = [
      { number: 1, qtype: "tfng", mode: "exact", accept: ["TRUE"] },
      { number: 2, qtype: "mcq_single", mode: "exact", accept: ["A"] }, // без ответа
    ];
    const r = grade(keys, { "1": "true" });
    const q1 = r.perQuestion.find((p) => p.number === 1)!;
    const q2 = r.perQuestion.find((p) => p.number === 2)!;
    expect(q1.given).toBe("true");
    expect(q1.correct).toBe(true);
    expect(q2.given).toBeNull();
    expect(q2.correct).toBe(false);
  });
});
