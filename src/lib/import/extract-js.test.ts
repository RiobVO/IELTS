// Юнит-тесты извлечения встроенных JS-данных (BRIEF §4.2). Самый чувствительный
// к безопасности модуль: vm-изоляция + балансировка скобок. Полностью inline.
import { describe, it, expect } from "vitest";
import {
  evalDataObject,
  extractData,
  extractFunctionTable,
  extractObjectLiteral,
} from "./extract-js";

describe("extractObjectLiteral", () => {
  it("возвращает сбалансированный по скобкам литерал, включая вложенные объекты", () => {
    expect(extractObjectLiteral("const o = { a: { b: 1 } };", "o")).toBe("{ a: { b: 1 } }");
  });

  it("не путается со скобкой `}` внутри строки", () => {
    // наивный счётчик скобок остановился бы на `}` в строке и вернул мусор
    expect(extractObjectLiteral('const o = { closer: "}" };', "o")).toBe('{ closer: "}" }');
  });

  it("находит const/let/var", () => {
    expect(extractObjectLiteral("let o = {};", "o")).toBe("{}");
    expect(extractObjectLiteral("var o = {};", "o")).toBe("{}");
  });

  it("null, если имя не найдено, за ним не объект, или скобки не закрыты", () => {
    expect(extractObjectLiteral("const o = {};", "missing")).toBeNull();
    expect(extractObjectLiteral("const o = 5;", "o")).toBeNull();
    expect(extractObjectLiteral("const o = { a: 1", "o")).toBeNull();
  });
});

describe("evalDataObject", () => {
  it("разбирает литерал в JS-значение", () => {
    expect(evalDataObject("{ a: 1, b: [2, 3] }")).toEqual({ a: 1, b: [2, 3] });
  });

  it("изолирован: глобалы Node не видны в песочнице", () => {
    // в реальном модуле typeof process === "object"; в песочнице — "undefined"
    expect(evalDataObject("{ leaked: typeof process }")).toEqual({ leaked: "undefined" });
  });
});

describe("extractData", () => {
  it("извлекает и вычисляет именованный объект", () => {
    const src = `const correctAnswers = { "1": "A", "2": "B" };`;
    expect(extractData(src, "correctAnswers")).toEqual({ "1": "A", "2": "B" });
  });

  it("null, если объект не найден", () => {
    expect(extractData("const x = {};", "nope")).toBeNull();
  });

  it("null (а не выброс наружу), если литерал падает при вычислении", () => {
    // ссылка на отсутствующий в песочнице глобал → throw внутри → catch → null
    expect(extractData("const bad = { v: process.pid };", "bad")).toBeNull();
  });
});

describe("extractFunctionTable", () => {
  it("материализует пороговую функцию band(r) в таблицу {raw: band}", () => {
    const src = "function band(r){ return r >= 39 ? 9 : r >= 20 ? 7 : 5; }";
    const t = extractFunctionTable(src, "band", 0, 40);
    expect(t).not.toBeNull();
    expect(Object.keys(t!)).toHaveLength(41); // 0..40 включительно
    expect(t![40]).toBe(9);
    expect(t![20]).toBe(7);
    expect(t![19]).toBe(5);
    expect(t![0]).toBe(5);
  });

  it("включает только числовые результаты", () => {
    const src = `function f(r){ return r < 2 ? "x" : r; }`;
    expect(extractFunctionTable(src, "f", 0, 3)).toEqual({ 2: 2, 3: 3 }); // 0,1 -> строка, отброшены
  });

  it("null, если функция не найдена или таблица пуста", () => {
    expect(extractFunctionTable("function f(){ return 1; }", "nope", 0, 5)).toBeNull();
    expect(extractFunctionTable(`function f(){ return "x"; }`, "f", 0, 3)).toBeNull(); // нет чисел
  });

  it("изолирован: вычисление функции не может писать в реальный global", () => {
    const sentinel = "__vm_escape_sentinel__";
    const t = extractFunctionTable(
      `function band(r){ globalThis.${sentinel} = true; return r; }`,
      "band",
      0,
      1,
    );
    expect(t).toEqual({ 0: 0, 1: 1 }); // функция отработала в песочнице
    expect((globalThis as Record<string, unknown>)[sentinel]).toBeUndefined(); // но наружу не вырвалась
  });
});
