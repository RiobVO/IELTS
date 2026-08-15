// Юнит-тесты извлечения встроенных JS-данных (BRIEF §4.2). Самый чувствительный
// к безопасности модуль: vm-изоляция + балансировка скобок. Полностью inline.
import { describe, it, expect } from "vitest";
import {
  evalDataObject,
  extractData,
  extractFunctionTable,
  extractObjectLiteral,
  extractRangeBuilderTable,
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

// P2 (2026-07-09): апостроф в // или /* */-комментарии ВНУТРИ объекта открывал
// фантомную "строку" → счётчик скобок сбивался → extractObjectLiteral возвращал null.
// Это security-путь: тот же сканер чистит correctAnswers из runner_html (blankObject),
// молчаливый null => сырой ключ уезжает в браузер mock-iframe. Сканер должен быть
// comment-aware: содержимое комментария не участвует ни в подсчёте кавычек, ни скобок.
describe("extractObjectLiteral — comment-aware (P2)", () => {
  it("апостроф в // -комментарии не открывает фантомную строку", () => {
    const src = `const o = { // don't touch\n"1": "TRUE" };`;
    expect(extractObjectLiteral(src, "o")).toBe(`{ // don't touch\n"1": "TRUE" }`);
  });

  it("апостроф и скобки в /* */-комментарии не ломают баланс", () => {
    const src = `const o = { /* don't {drop} me */ "1": "A" };`;
    expect(extractObjectLiteral(src, "o")).toBe(`{ /* don't {drop} me */ "1": "A" }`);
  });

  it("несбалансированная скобка в комментарии не влияет на depth снаружи", () => {
    const src = `const o = { a: 1 // trailing brace } here\n};`;
    expect(extractObjectLiteral(src, "o")).toBe(`{ a: 1 // trailing brace } here\n}`);
  });

  it("`//` внутри строки НЕ считается комментарием (не ломать строки-URL)", () => {
    const src = `const o = { url: "http://x/}y" };`;
    expect(extractObjectLiteral(src, "o")).toBe(`{ url: "http://x/}y" }`);
  });

  // Adversarial (Codex, 2026-07-09): comment-aware цикл стартует ПОСЛЕ пре-скана
  // между `=` и `{`, который пропускал только whitespace → комментарий там ронял
  // extractObjectLiteral в null ДО цикла → blankObject молча пропускал объект (утечка).
  it("пропускает block-комментарий между `=` и `{`", () => {
    const src = `const o = /* between */ { "1": "A" };`;
    expect(extractObjectLiteral(src, "o")).toBe(`{ "1": "A" }`);
  });

  it("пропускает line-комментарий между `=` и `{`", () => {
    const src = `const o = // note\n{ "1": "A" };`;
    expect(extractObjectLiteral(src, "o")).toBe(`{ "1": "A" }`);
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

  it("отклоняет литерал сверх size-gate до vm (#20 — heap-cap)", () => {
    // vm.timeout не ограничивает heap; аномально большой литерал бракуем ДО eval,
    // чтобы poison-файл не уронил процесс импорта по памяти.
    const huge = `{ "a": "${"x".repeat(4 * 1024 * 1024 + 1)}" }`;
    expect(() => evalDataObject(huge)).toThrow(RangeError);
    // extractData ловит throw и возвращает null (не роняет импорт)
    expect(extractData(`const big = ${huge};`, "big")).toBeNull();
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

  it("null, если тело функции сверх size-gate (#20 — heap-cap)", () => {
    // Функция с гигантским телом бракуется ДО исполнения в vm (defense against OOM).
    const bigBody = `function band(r){ const s = "${"y".repeat(4 * 1024 * 1024 + 1)}"; return r; }`;
    expect(extractFunctionTable(bigBody, "band", 0, 3)).toBeNull();
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

describe("extractRangeBuilderTable", () => {
  it("разворачивает range-builder IIFE в {q: type} по диапазонам (без eval)", () => {
    // Декларация — пустой `{}`; реальный маппинг строит сеттер во время выполнения.
    const src = `const QTYPE = {};
(function(){ const set = (a, b, t) => { for (let q = a; q <= b; q++) QTYPE[q] = t; };
  set(1, 6, 'Table completion'); })();`;
    expect(extractRangeBuilderTable(src, "QTYPE")).toEqual({
      "1": "Table completion",
      "2": "Table completion",
      "3": "Table completion",
      "4": "Table completion",
      "5": "Table completion",
      "6": "Table completion",
    });
  });

  it("null, если сеттер не пишет в искомое имя (другой объект)", () => {
    // Сеттер найден, но присваивает в OTHER[...], не в QTYPE → форма не распознана.
    const src = `const QTYPE = {};
(function(){ const set = (a, b, t) => { for (let q = a; q <= b; q++) OTHER[q] = t; };
  set(1, 6, 'Table completion'); })();`;
    expect(extractRangeBuilderTable(src, "QTYPE")).toBeNull();
  });

  it("null на пустой таблице (сеттер есть, но ни одного вызова)", () => {
    const src = `const QTYPE = {};
(function(){ const set = (a, b, t) => { for (let q = a; q <= b; q++) QTYPE[q] = t; }; })();`;
    expect(extractRangeBuilderTable(src, "QTYPE")).toBeNull();
  });
});
