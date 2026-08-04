// Грейдинг публичного Band Predictor (G1-6): подсчёт, слабейший тип и честность
// диапазона. Ключи приходят параметром — тест не тянет server-only банк.
import { describe, it, expect } from "vitest";
import { bandRange, formatBandRange, gradePredictor, type GradableQuestion } from "./grade";

const QUESTIONS: GradableQuestion[] = [
  { number: 1, qtype: "tfng", accept: ["TRUE"] },
  { number: 2, qtype: "tfng", accept: ["FALSE"] },
  { number: 3, qtype: "sentence_completion", accept: ["eighteen", "18"] },
  { number: 4, qtype: "mcq_single", accept: ["first option"] },
];

describe("gradePredictor", () => {
  it("считает верные ответы без учёта регистра, пробелов и финальной точки", () => {
    const r = gradePredictor(QUESTIONS, {
      "1": " true ",
      "2": "False.",
      "3": "EIGHTEEN",
      "4": "first  option",
    });
    expect(r.correct).toBe(4);
    expect(r.total).toBe(4);
    expect(r.weakType).toBeNull(); // идеальная проба не выдумывает слабость
  });

  it("любой из принимаемых вариантов засчитывается", () => {
    expect(gradePredictor(QUESTIONS, { "3": "18" }).correct).toBe(1);
  });

  it("пропуски и мусор — это «не отвечено», а не падение", () => {
    const r = gradePredictor(QUESTIONS, { "1": "", "2": null, "3": 18, "9": "TRUE" } as Record<string, unknown>);
    expect(r.correct).toBe(0);
    expect(r.total).toBe(4);
  });

  it("слабейший тип — по ДОЛЕ верных, а не по числу ошибок", () => {
    // tfng: 1/2 = 0.5; sentence_completion: 0/1 = 0 — слабее, хоть ошибка одна.
    const r = gradePredictor(QUESTIONS, { "1": "TRUE", "2": "TRUE", "3": "twenty", "4": "first option" });
    expect(r.weakType).toBe("sentence_completion");
  });
});

describe("bandRange", () => {
  it("монотонен: больше верных — не ниже диапазон", () => {
    let prevLow = -Infinity;
    for (let c = 0; c <= 10; c++) {
      const { low, high } = bandRange(c, 10);
      expect(low).toBeGreaterThanOrEqual(prevLow);
      expect(high).toBeGreaterThan(low);
      prevLow = low;
    }
  });

  it("не обещает высокий band за слабый результат", () => {
    expect(bandRange(0, 10).high).toBeLessThanOrEqual(5);
    expect(bandRange(5, 10).high).toBeLessThanOrEqual(6);
  });

  it("идеальная проба не обещает 9.0 — потолок диапазона консервативен", () => {
    expect(bandRange(10, 10).high).toBeLessThanOrEqual(8.5);
  });

  it("вырожденный ввод (total=0) не роняет и не выдаёт мусор", () => {
    expect(bandRange(0, 0)).toEqual({ low: 4, high: 4.5 });
  });

  it("формат — всегда один знак после точки", () => {
    expect(formatBandRange(6, 6.5)).toBe("6.0–6.5");
    expect(formatBandRange(7.5, 8.5)).toBe("7.5–8.5");
  });
});
