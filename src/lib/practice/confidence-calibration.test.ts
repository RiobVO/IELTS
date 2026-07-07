// Юнит-тесты чистой калибровки уверенности (P10). Контракт: парсер отбрасывает
// мусор; джойн считает overconfident (high∧wrong) / underconfident (low∧correct);
// метка без оценённого вопроса игнорируется; нет валидных меток → null.
import { describe, it, expect } from "vitest";
import {
  computeConfidenceCalibration,
  parseConfidenceMap,
} from "./confidence-calibration";

describe("parseConfidenceMap", () => {
  it("валидный JSON → карта только с допустимыми уровнями", () => {
    const raw = JSON.stringify({ "1": "high", "2": "low", "3": "med" });
    expect(parseConfidenceMap(raw)).toEqual({ "1": "high", "2": "low", "3": "med" });
  });

  it("мусорные значения и не-строки отбрасываются", () => {
    const raw = JSON.stringify({ "1": "high", "2": "banana", "3": 5, "4": null });
    expect(parseConfidenceMap(raw)).toEqual({ "1": "high" });
  });

  it("пустой / битый / не-объект вход → пустая карта", () => {
    expect(parseConfidenceMap(null)).toEqual({});
    expect(parseConfidenceMap("")).toEqual({});
    expect(parseConfidenceMap("{not json")).toEqual({});
    expect(parseConfidenceMap("[1,2,3]")).toEqual({}); // массив: нет валидных пар level
  });
});

describe("computeConfidenceCalibration", () => {
  const verdicts = [
    { number: 1, correct: false },
    { number: 2, correct: true },
    { number: 3, correct: false },
    { number: 4, correct: true },
  ];

  it("high∧wrong → overconfident (номера отсортированы); low∧correct → underconfident", () => {
    const res = computeConfidenceCalibration(verdicts, {
      "3": "high", // sure but wrong
      "1": "high", // sure but wrong
      "2": "low", // unsure but right
      "4": "high", // sure and right → ни туда, ни сюда
    });
    expect(res).not.toBeNull();
    expect(res!.overconfident).toEqual([1, 3]);
    expect(res!.underconfident).toBe(1);
    expect(res!.marked).toBe(4);
    expect(res!.highTotal).toBe(3);
    expect(res!.lowTotal).toBe(1);
  });

  it("метка без соответствующего оценённого вопроса игнорируется", () => {
    const res = computeConfidenceCalibration(verdicts, {
      "1": "high",
      "99": "high", // такого вопроса нет
      "abc": "low", // нечисловой ключ
    });
    expect(res!.marked).toBe(1);
    expect(res!.overconfident).toEqual([1]);
  });

  it("нет валидных меток → null (блок не рендерится)", () => {
    expect(computeConfidenceCalibration(verdicts, {})).toBeNull();
    expect(computeConfidenceCalibration(verdicts, { "77": "high" })).toBeNull();
    expect(computeConfidenceCalibration([], { "1": "high" })).toBeNull();
  });

  it("хорошо откалиброван (совпадение) → результат есть, но списки пусты", () => {
    const res = computeConfidenceCalibration(verdicts, {
      "2": "high", // sure and right
      "1": "low", // unsure and wrong
    });
    expect(res!.overconfident).toEqual([]);
    expect(res!.underconfident).toBe(0);
    expect(res!.marked).toBe(2);
  });
});
