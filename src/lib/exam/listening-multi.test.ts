// Юнит-тесты зеркала мостового __multiFor (bridge.ts) для атомизированного
// listening-practice. Относительный импорт.
import { describe, it, expect } from "vitest";
import {
  bridgeLetterFor,
  bridgeLettersFor,
  groupMembers,
  readingGroupToggle,
  toggleGroupLetter,
  unionChosen,
} from "./listening-multi";

describe("bridgeLetterFor", () => {
  it("сортирует и раздаёт буквы по позиции члена группы", () => {
    expect(bridgeLetterFor(["C", "E"], [11, 12], 11)).toBe("C");
    expect(bridgeLetterFor(["C", "E"], [11, 12], 12)).toBe("E");
  });

  it("один выбор — второй член получает пустую строку", () => {
    expect(bridgeLetterFor(["E"], [11, 12], 11)).toBe("E");
    expect(bridgeLetterFor(["E"], [11, 12], 12)).toBe("");
  });

  it("лишняя буква — раздаются только первые по позиции", () => {
    expect(bridgeLetterFor(["A", "C", "E"], [11, 12], 11)).toBe("A");
    expect(bridgeLetterFor(["A", "C", "E"], [11, 12], 12)).toBe("C");
  });

  it("пустой выбор → пустая строка для любого члена", () => {
    expect(bridgeLetterFor([], [11, 12], 11)).toBe("");
    expect(bridgeLetterFor([], [11, 12], 12)).toBe("");
  });

  it("несортированный ввод даёт тот же результат, что и отсортированный", () => {
    expect(bridgeLetterFor(["E", "C"], [11, 12], 11)).toBe("C");
    expect(bridgeLetterFor(["E", "C"], [11, 12], 12)).toBe("E");
  });

  it("сортировка лексикографическая, НЕ numeric — как JS Array.sort в мосте", () => {
    // sort(["2","10"]) → ["10","2"]: "10" < "2" лексикографически.
    expect(bridgeLetterFor(["2", "10"], [11, 12], 11)).toBe("10");
    expect(bridgeLetterFor(["2", "10"], [11, 12], 12)).toBe("2");
  });

  it("регистр букв не трогается (мост тоже не нормализует регистр)", () => {
    expect(bridgeLetterFor(["e", "C"], [11, 12], 11)).toBe("C");
    expect(bridgeLetterFor(["e", "C"], [11, 12], 12)).toBe("e");
  });

  it("вырожденный случай — один член в группе, эквивалент моста по индексу 0", () => {
    expect(bridgeLetterFor(["B"], [13], 13)).toBe("B");
  });

  it("эквивалентность прод-аттемпту 01433bab: {B} на группе [13,14] → Q13 получает B", () => {
    expect(bridgeLetterFor(["B"], [13, 14], 13)).toBe("B");
    expect(bridgeLetterFor(["B"], [13, 14], 14)).toBe("");
  });
});

describe("unionChosen", () => {
  it("объединяет значения членов, схлопывая дубликаты (общий стейт группы)", () => {
    expect(unionChosen({ "11": ["C", "E"], "12": ["C", "E"] }, [11, 12]).sort()).toEqual(["C", "E"]);
  });

  it("string-значение члена (legacy) считается набором из одной буквы", () => {
    expect(unionChosen({ "13": "B", "14": [] }, [13, 14])).toEqual(["B"]);
  });

  it("пустые строки и отсутствующие члены не попадают в набор", () => {
    expect(unionChosen({ "13": "", "14": undefined }, [13, 14])).toEqual([]);
  });
});

describe("bridgeLettersFor", () => {
  it("{C,E} только у первого члена → оба члена получают буквы (защита от per-member трансформации)", () => {
    expect(bridgeLettersFor({ "11": ["C", "E"], "12": [] }, [11, 12])).toEqual({ 11: "C", 12: "E" });
  });

  it("расходящиеся массивы членов → union, раздача позиционная", () => {
    expect(bridgeLettersFor({ "11": ["C"], "12": ["E"] }, [11, 12])).toEqual({ 11: "C", 12: "E" });
  });

  it("один член пустой, другой полный → оба получают буквы", () => {
    expect(bridgeLettersFor({ "13": "", "14": ["A", "B"] }, [13, 14])).toEqual({ 13: "A", 14: "B" });
  });

  it("одинаковый общий набор у обоих членов не дублируется", () => {
    expect(bridgeLettersFor({ "11": ["C", "E"], "12": ["C", "E"] }, [11, 12])).toEqual({ 11: "C", 12: "E" });
  });

  it("string-значение члена (legacy) → union как одиночная буква", () => {
    expect(bridgeLettersFor({ "13": "B", "14": [] }, [13, 14])).toEqual({ 13: "B", 14: "" });
  });

  it("пустая группа значений → пустые строки для всех членов", () => {
    expect(bridgeLettersFor({}, [11, 12])).toEqual({ 11: "", 12: "" });
  });
});

describe("toggleGroupLetter", () => {
  it("divergent-untoggle: снятая буква не воскресает из соседнего члена", () => {
    // Члены разошлись (resume старой попытки): union {C,E}; снимаем C → только E.
    expect(toggleGroupLetter({ "11": ["C", "E"], "12": ["C"] }, [11, 12], "C")).toEqual(["E"]);
  });

  it("shared-write: один итоговый набор из расходящихся членов", () => {
    expect(toggleGroupLetter({ "11": ["C"], "12": ["E"] }, [11, 12], "A")).toEqual(["A", "C", "E"]);
  });

  it("sort-order: итог отсортирован лексикографически, как в мосте", () => {
    expect(toggleGroupLetter({ "11": ["C"], "12": ["A"] }, [11, 12], "B")).toEqual(["A", "B", "C"]);
    expect(toggleGroupLetter({ "11": ["10"] }, [11, 12], "2")).toEqual(["10", "2"]);
  });

  it("пара add→remove идемпотентна: возвращает исходный union (отсортированный)", () => {
    const values = { "11": ["E", "C"], "12": [] };
    const added = toggleGroupLetter(values, [11, 12], "A");
    expect(added).toEqual(["A", "C", "E"]);
    // Второй тоггл — оба члена уже несут общий результат первого (shared-write).
    const removed = toggleGroupLetter({ "11": added, "12": added }, [11, 12], "A");
    expect(removed).toEqual(["C", "E"]);
  });

  it("тоггл на пустой группе добавляет первую букву", () => {
    expect(toggleGroupLetter({}, [11, 12], "B")).toEqual(["B"]);
  });
});

describe("readingGroupToggle (reading choose-TWO — полный набор, НЕ позиционно)", () => {
  it("добавляет букву к union членов и сортирует", () => {
    expect(readingGroupToggle({ "23": ["A"], "24": ["A"] }, [23, 24], "E")).toEqual(["A", "E"]);
  });

  it("снимает уже выбранную букву", () => {
    expect(readingGroupToggle({ "23": ["A", "E"], "24": ["A", "E"] }, [23, 24], "E")).toEqual(["A"]);
  });

  it("дивергентный resume: клик НЕ теряет букву соседнего члена (union, не кликнутый массив)", () => {
    // Легаси-попытка разошлась (Q23=[A], Q24=[E]). Клик по первому члену (n=23) с буквой B
    // должен дать полный union {A,E}+B, а не {A}+B — иначе E терялась бы и персистилась.
    expect(readingGroupToggle({ "23": ["A"], "24": ["E"] }, [23, 24], "B")).toEqual(["A", "B", "E"]);
    // Снятие A из дивергентного старта оставляет E (не воскрешает из соседа).
    expect(readingGroupToggle({ "23": ["A"], "24": ["E"] }, [23, 24], "A")).toEqual(["E"]);
  });

  it("пустой/legacy string член → union как одиночная буква", () => {
    expect(readingGroupToggle({ "23": "", "24": undefined }, [23, 24], "A")).toEqual(["A"]);
    expect(readingGroupToggle({ "23": "A", "24": [] }, [23, 24], "E")).toEqual(["A", "E"]);
  });
});

describe("groupMembers", () => {
  it("возвращает номера вопросов с тем же group_key, по возрастанию", () => {
    const questions = [
      { number: 12, group_key: "11-12" },
      { number: 11, group_key: "11-12" },
      { number: 10, group_key: null },
    ];
    expect(groupMembers(questions, "11-12")).toEqual([11, 12]);
  });

  it("нет вопросов с таким group_key → пустой список", () => {
    expect(groupMembers([{ number: 1, group_key: null }], "1-2")).toEqual([]);
  });
});
