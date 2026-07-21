// Юнит-тесты извлечения встроенных JS-данных (BRIEF §4.2). Самый чувствительный
// к безопасности модуль: vm-изоляция + балансировка скобок. Полностью inline.
import { describe, it, expect } from "vitest";
import {
  evalDataObject,
  extractData,
  extractFunctionTable,
  extractObjectLiteral,
  extractRangeBuilderTable,
  isExecutableScriptType,
} from "./extract-js";

describe("isExecutableScriptType — что браузер реально исполняет как JS", () => {
  it("classic/module JS исполняется", () => {
    for (const t of [undefined, null, "", "  ", "text/javascript", "application/javascript", "module", "TEXT/JavaScript"]) {
      expect(isExecutableScriptType(t)).toBe(true);
    }
  });
  it("не-JS type инертен (данные, не код)", () => {
    for (const t of ["application/json", "text/template", "application/ld+json", "speculationrules"]) {
      expect(isExecutableScriptType(t)).toBe(false);
    }
  });
});

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
  it("разбирает литерал в JS-значение", async () => {
    expect(await evalDataObject("{ a: 1, b: [2, 3] }")).toEqual({ a: 1, b: [2, 3] });
  });

  it("изолирован: глобалы Node не видны в песочнице", async () => {
    // в реальном модуле typeof process === "object"; в песочнице — "undefined"
    expect(await evalDataObject("{ leaked: typeof process }")).toEqual({ leaked: "undefined" });
  });

  it("отклоняет литерал сверх size-gate до воркера (#20 — heap-cap)", async () => {
    // size-gate бракует аномально большой литерал СИНХРОННО, до спавна воркера — poison-файл
    // не платит за поток. evalDataObject не async (throw синхронный), поэтому toThrow ловит.
    const huge = `{ "a": "${"x".repeat(4 * 1024 * 1024 + 1)}" }`;
    expect(() => evalDataObject(huge)).toThrow(RangeError);
    // extractData ловит throw и возвращает null (не роняет импорт)
    expect(await extractData(`const big = ${huge};`, "big")).toBeNull();
  });
});

describe("extractData", () => {
  it("извлекает и вычисляет именованный объект", async () => {
    const src = `const correctAnswers = { "1": "A", "2": "B" };`;
    expect(await extractData(src, "correctAnswers")).toEqual({ "1": "A", "2": "B" });
  });

  it("null, если объект не найден", async () => {
    expect(await extractData("const x = {};", "nope")).toBeNull();
  });

  it("null (а не выброс наружу), если литерал падает при вычислении", async () => {
    // ссылка на отсутствующий в песочнице глобал → throw внутри → catch → null
    expect(await extractData("const bad = { v: process.pid };", "bad")).toBeNull();
  });
});

describe("extractFunctionTable", () => {
  it("материализует пороговую функцию band(r) в таблицу {raw: band}", async () => {
    const src = "function band(r){ return r >= 39 ? 9 : r >= 20 ? 7 : 5; }";
    const t = await extractFunctionTable([src], "band", 0, 40);
    expect(t).not.toBeNull();
    expect(Object.keys(t!)).toHaveLength(41); // 0..40 включительно
    expect(t![40]).toBe(9);
    expect(t![20]).toBe(7);
    expect(t![19]).toBe(5);
    expect(t![0]).toBe(5);
  });

  it("включает только числовые результаты", async () => {
    const src = `function f(r){ return r < 2 ? "x" : r; }`;
    expect(await extractFunctionTable([src], "f", 0, 3)).toEqual({ 2: 2, 3: 3 }); // 0,1 -> строка, отброшены
  });

  it("null, если функция не найдена или таблица пуста", async () => {
    expect(await extractFunctionTable(["function f(){ return 1; }"], "nope", 0, 5)).toBeNull();
    expect(await extractFunctionTable([`function f(){ return "x"; }`], "f", 0, 3)).toBeNull(); // нет чисел
  });

  it("null, если тело функции сверх size-gate (#20 — heap-cap)", async () => {
    // Функция с гигантским телом бракуется ДО исполнения (defense against OOM), спавна воркера нет.
    const bigBody = `function band(r){ const s = "${"y".repeat(4 * 1024 * 1024 + 1)}"; return r; }`;
    expect(await extractFunctionTable([bigBody], "band", 0, 3)).toBeNull();
  });

  it("изолирован: вычисление функции не может писать в реальный global", async () => {
    const sentinel = "__vm_escape_sentinel__";
    const t = await extractFunctionTable([
      `function band(r){ globalThis.${sentinel} = true; return r; }`],
      "band",
      0,
      1,
    );
    expect(t).toEqual({ 0: 0, 1: 1 }); // функция отработала в песочнице
    expect((globalThis as Record<string, unknown>)[sentinel]).toBeUndefined(); // но наружу не вырвалась
  });
});

// Ранее эти дефекты чинил текстовый лексер (comment-aware балансировщик). Теперь скрипт
// парсит V8: закомментированная декларация не связывается (нет живого кода для матча), а `}`
// внутри комментария — забота грамматики, не нашей. Тесты сохранены как проверка семантики
// механизма.
describe("extractFunctionTable — комментарии (семантика V8)", () => {
  it("целиком закомментированная декларация НЕ материализуется как живой код", async () => {
    const src = `/* function band(r){ return r >= 39 ? 9 : 5; } */\nvar x = 1;`;
    expect(await extractFunctionTable([src], "band", 0, 40)).toBeNull();
  });

  it("закомментированный helper не подхватывается (getBandFor40 → undefined getBandFor13)", async () => {
    // getBandFor40 реальный, но getBandFor13 живёт ТОЛЬКО в комментарии → не объявлен →
    // делегатор падает ReferenceError на каждом r → пустая таблица → null.
    const src =
      `/* function getBandFor13(s){ return s >= 39 ? 9 : 4; } */\n` +
      `function getBandFor40(s){ return getBandFor13(s); }`;
    expect(await extractFunctionTable([src], "getBandFor40", 0, 40)).toBeNull();
  });

  it("`}` в комментарии тела реальной функции не ломает извлечение (шкала уцелевает)", async () => {
    const src = `function band(r){ /* closes here } trap */ return r >= 39 ? 9 : 5; }`;
    const t = await extractFunctionTable([src], "band", 0, 40);
    expect(t).not.toBeNull();
    expect(t![40]).toBe(9);
    expect(t![0]).toBe(5);
  });
});

// Ранее это чинил канонический лексер (regex-vs-деление по токену + стек template). Теперь
// парсит V8, поэтому кейсы сохранены как проверка семантики механизма.
describe("extractFunctionTable — regex/template (семантика V8)", () => {
  it("regex после `return` НЕ материализуется как функция", async () => {
    const src = `function wrapper(){ return /function band(r){return 9;}/; }`;
    expect(await extractFunctionTable([src], "band", 0, 40)).toBeNull();
  });

  it("фейковая функция во вложенном template НЕ извлекается", async () => {
    const src = 'const t = `outer ${cond ? `function band(r){return 9;}` : "x"}`;';
    expect(await extractFunctionTable([src], "band", 0, 40)).toBeNull();
  });

  it("реальная функция ПОСЛЕ вложенного template с апострофом/`}` внутри извлекается", async () => {
    const src =
      "const label = `${flag ? `it's }` : ''}`;\n" +
      "function getBand(r){ return r >= 39 ? 9 : 4; }";
    const t = await extractFunctionTable([src], "getBand", 0, 40);
    expect(t).not.toBeNull();
    expect(t![40]).toBe(9);
    expect(t![0]).toBe(4);
  });

  it("regex после `if(...)` не материализуется; деления не ломают разбор ниже", async () => {
    const reSrc = `if (cond) /function fake(r){return 1;}/;`;
    expect(await extractFunctionTable([reSrc], "fake", 0, 5)).toBeNull();
    const divSrc = `const q = a / b / c;\nfunction band(r){ return r >= 39 ? 9 : 5; }`;
    const t = await extractFunctionTable([divSrc], "band", 0, 40);
    expect(t).not.toBeNull();
    expect(t![40]).toBe(9);
  });

  it("фейковый helper внутри regex не подхватывается", async () => {
    // getBandFor13 «объявлен» только внутри regex-литерала → не связывается →
    // делегатор падает ReferenceError на каждом r → null.
    const src =
      "function wrapper(){ return /function getBandFor13(s){return 9;}/; }\n" +
      "function getBandFor40(s){ return getBandFor13(s); }";
    expect(await extractFunctionTable([src], "getBandFor40", 0, 40)).toBeNull();
  });
});

// Открытые repro ревью (2026-07-21): текстовый лексер maskLexical/regexAllowedAt не мог
// надёжно отличить regex от деления и блок-`}` от объектной. Пять оставшихся дыр. Механизм
// теперь парсит V8 (indirect-eval всего скрипта в изолированном воркере + чтение globalThis
// [name]), поэтому эти кейсы решаются грамматикой, а не эвристикой. Тесты — исполняемые repro.
describe("extractFunctionTable — V8 grammar, not our lexer (открытые repro)", () => {
  it("regex после `await` НЕ материализует фейковую функцию", async () => {
    // Лексер: `await` — идентификатор-слово (не в whitelist) → `/` читался как деление →
    // содержимое regex уезжало как живой код → фейковая band. V8: это regex-литерал.
    const src = `async function f(){ await x; return /function band(r){return 9;}/; }`;
    expect(await extractFunctionTable([src], "band", 0, 40)).toBeNull();
  });

  it("regex после блок-`}` НЕ материализует фейковую функцию", async () => {
    // После закрытия блок-statement `/` начинает новый statement (regex). Лексер трактовал
    // `}` как закрытие значения → деление → regex-тело уезжало как код.
    const src = `{ let y = 1; }\n/function band(r){return 9;}/;`;
    expect(await extractFunctionTable([src], "band", 0, 40)).toBeNull();
  });

  it("regex первым выражением в `${…}` tagged-template НЕ материализует функцию", async () => {
    // `/` сразу после `${` (первое выражение интерполяции) — regex. Фейковая декларация
    // внутри него не должна извлекаться.
    const src = 'const s = tag`${/function band(r){return 9;}/}`;';
    expect(await extractFunctionTable([src], "band", 0, 40)).toBeNull();
  });

  it("деление после postfix `++`/`--` не съедает реальную функцию ниже (ложный отказ)", async () => {
    // `i++ / 2 / 1` — деление (postfix-значение). Лексер видел `+` перед `/` → regex →
    // фантомный regex глотал реальную band ниже → ложный null. V8: деление, band цела.
    const src = `let i = 0; const z = i++ / 2 / 1;\nfunction band(r){ return r >= 39 ? 9 : 5; }`;
    const t = await extractFunctionTable([src], "band", 0, 40);
    expect(t).not.toBeNull();
    expect(t![40]).toBe(9);
    expect(t![0]).toBe(5);
  });

  it("деление после `obj.return` / `obj.if(...)` не съедает реальную функцию ниже (ложный отказ)", async () => {
    // `.return` / `.if` — имена свойств, не ключевые слова; результат делится. Лексер читал
    // слово `return`/`if` назад → regex → фантом глотал реальную band. V8: деление.
    const retSrc = `const a = obj.return / 2;\nfunction band(r){ return r >= 39 ? 9 : 5; }`;
    const rt = await extractFunctionTable([retSrc], "band", 0, 40);
    expect(rt).not.toBeNull();
    expect(rt![40]).toBe(9);
    const ifSrc = `const b = obj.if(1) / 2;\nfunction band(r){ return r >= 39 ? 9 : 5; }`;
    const it2 = await extractFunctionTable([ifSrc], "band", 0, 40);
    expect(it2).not.toBeNull();
    expect(it2![40]).toBe(9);
  });
});

// Подводные камни нового механизма (V8-парсинг всего скрипта в воркере): функция обязана
// извлекаться, даже если скрипт падает на browser-API (декларации хойстятся при
// EvalDeclarationInstantiation ДО исполнения statements); var/window-формы читаются с
// globalThis; несколько упоминаний имени; delegation без deps-параметра.
describe("extractFunctionTable — V8 hoist/isolation (подводные камни)", () => {
  it("скрипт падает на document.* ДО и ПОСЛЕ декларации — функция всё равно извлекается (а)", async () => {
    const src =
      `document.getElementById('x').innerHTML = 'boom';\n` +
      `function band(r){ return r >= 39 ? 9 : 5; }\n` +
      `window.addEventListener('load', () => band(0));`;
    const t = await extractFunctionTable([src], "band", 0, 40);
    expect(t).not.toBeNull();
    expect(t![40]).toBe(9);
    expect(t![0]).toBe(5);
  });

  it("delegation getBandFor40 → getBandFor13 работает нативно, без deps (а)", async () => {
    // Обе декларации в одном скоупе eval → делегатор находит helper. Между ними — throw
    // на document.*: обе функции уже хойстнуты, throw не мешает.
    const src =
      `function getBandFor13(s){ return s >= 16 ? 9 : 4; }\n` +
      `document.title = 'x';\n` +
      `function getBandFor40(s){ return getBandFor13(s); }`;
    const t = await extractFunctionTable([src], "getBandFor40", 0, 40);
    expect(t).not.toBeNull();
    expect(t![40]).toBe(9);
    expect(t![0]).toBe(4);
  });

  it("`var name = function(){}` читается с globalThis (д)", async () => {
    const src = `var band = function(r){ return r >= 39 ? 9 : 5; };`;
    const t = await extractFunctionTable([src], "band", 0, 40);
    expect(t).not.toBeNull();
    expect(t![40]).toBe(9);
  });

  it("несколько упоминаний имени: реальная декларация среди чужого кода извлекается (е)", async () => {
    // Имя мелькает в строке и в regex, но реальная декларация — в другом фрагменте.
    const src =
      `const note = "see function band below";\n` +
      `const rx = /function band(r){return 0;}/;\n` +
      `function band(r){ return r >= 39 ? 9 : 5; }`;
    const t = await extractFunctionTable([src], "band", 0, 40);
    expect(t).not.toBeNull();
    expect(t![40]).toBe(9);
  });

  it("`while(true)` в теле скрипта → таймаут воркера → null, процесс жив (г)", async () => {
    const src = `while (true) {}\nfunction band(r){ return 9; }`;
    expect(await extractFunctionTable([src], "band", 0, 40)).toBeNull();
    // Процесс пережил: валидная экстракция сразу после таймаута работает.
    const ok = await extractFunctionTable(["function band(r){ return r >= 39 ? 9 : 5; }"], "band", 0, 40);
    expect(ok?.[40]).toBe(9);
  });

  it("закомментированная декларация НЕ извлекается — V8 сам разберёт (б)", async () => {
    const src = `/* function band(r){ return r >= 39 ? 9 : 5; } */\nvar x = 1;`;
    expect(await extractFunctionTable([src], "band", 0, 40)).toBeNull();
  });
});

// Финальное доведение до браузер-эквивалентной модели (ревью 2026-07-21): скрипты грузятся
// как classic <script> — массив блоков БЕЗ склейки, каждый компилируется/исполняется отдельно
// в общем browser-like контексте (window/self алиасят глобал). Четыре дефекта старой indirect-
// eval-модели ((0,eval) склеенного src), у каждого исполняемый repro.
describe("extractFunctionTable — браузер-эквивалентная загрузка (4 repro)", () => {
  it("defect1 strict-mode: 'use strict' + function decl всё равно садится на глобал", async () => {
    // (0,eval) в strict-режиме делал декларацию eval-локальной → globalThis.band undefined → null.
    // Script-mode (GlobalDeclarationInstantiation) кладёт её на глобал контекста независимо от strict.
    const src = `"use strict";\nfunction band(r){ return r >= 39 ? 9 : 5; }`;
    const t = await extractFunctionTable([src], "band", 0, 40);
    expect(t).not.toBeNull();
    expect(t![40]).toBe(9);
    expect(t![0]).toBe(5);
  });

  it("defect2 изоляция блоков: SyntaxError/JSON-мусор в блоке 1 не убивает декларацию в блоке 2", async () => {
    // Склейка делала из блоков один compilation unit → синтакс-ошибка роняла всё в null.
    // Раздельная компиляция блоков (как отдельные <script>) изолирует битый блок.
    const blocks = [`{"x":}`, `function band(r){ return r >= 39 ? 9 : 5; }`];
    const t = await extractFunctionTable(blocks, "band", 0, 40);
    expect(t).not.toBeNull();
    expect(t![40]).toBe(9);
  });

  it("defect2 изоляция блоков: throw в блоке 1 не мешает блоку 2 (браузерная семантика)", async () => {
    // `function band(){return 1}; throw` в блоке 1, `band = function(){return 2}` в блоке 2.
    // Склейка: throw обрывал исполнение до реассайна → band=1. Раздельно: блок 2 переопределяет → 2.
    const blocks = [`function band(r){ return 1; } throw new Error('boom');`, `band = function(r){ return 2; };`];
    const t = await extractFunctionTable(blocks, "band", 0, 5);
    expect(t).not.toBeNull();
    expect(t![3]).toBe(2);
  });

  it("defect3 отравление: globalThis-подмена и Object.prototype-сеттер не искажают реальную таблицу", async () => {
    // globalThis={band:()=>111} не должна подменить lookup (читаем own-property контекста),
    // а numeric-сеттер на Object.prototype не должен исказить host-таблицу (Object.create(null) в
    // realm воркера, вне контекста). Реальная band(5)=5 обязана уцелеть.
    const blocks = [
      `function band(r){ return r >= 39 ? 9 : 5; }`,
      `try { globalThis = { band: function(){ return 111; } }; } catch(e){}
       Object.defineProperty(Object.prototype, '5', { configurable: true, set(){ throw new Error('poison'); }, get(){ return 999; } });
       Object.create = function(){ return {}; };`,
    ];
    const t = await extractFunctionTable(blocks, "band", 0, 40);
    expect(t).not.toBeNull();
    expect(Object.keys(t!)).toHaveLength(41);
    expect(t![5]).toBe(5); // не 999 и не выброшено сеттером
    expect(t![40]).toBe(9);
  });

  it("defect4 window.band = function: форма через window-алиас извлекается", async () => {
    // Комментарий раньше заявлял поддержку window.name, но в Object.create(null)-контексте
    // window не было → ReferenceError → null. Теперь window/self алиасят глобал контекста.
    const src = `window.band = function(r){ return r >= 39 ? 9 : 5; };`;
    const t = await extractFunctionTable([src], "band", 0, 40);
    expect(t).not.toBeNull();
    expect(t![40]).toBe(9);
    expect(t![0]).toBe(5);
  });

  it("self.band = function: второй browser-алиас глобала тоже работает", async () => {
    const src = `self.band = function(r){ return r >= 39 ? 9 : 5; };`;
    const t = await extractFunctionTable([src], "band", 0, 40);
    expect(t).not.toBeNull();
    expect(t![40]).toBe(9);
  });

  it("non-JS type отфильтрован каллером: блок application/json не доходит до исполнения", async () => {
    // Каллеры (parse-*) не передают <script type='application/json'> в extractFunctionTable.
    // Здесь моделируем результат фильтра isExecutableScriptType: битый блок просто не в массиве.
    const blocks = [`function band(r){ return r >= 39 ? 9 : 5; }`];
    const t = await extractFunctionTable(blocks, "band", 0, 40);
    expect(t![40]).toBe(9);
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

// #20 — worker-изоляция исполнения. Репро аудита: 59-байтная аллокационная бомба
// (`while(true) a.push(new Array(1e6))`) раньше валила ВЕСЬ серверный процесс
// (`FATAL ERROR: heap out of memory`, exit 134) за ~155мс — быстрее vm.timeout, и это
// фатальный abort V8, а НЕ throw, который try/catch мог бы поймать. Теперь исполнение
// живёт в worker_threads-изоляте с maxOldGenerationSizeMb: бомба убивает ТОЛЬКО воркер
// (ERR_WORKER_OUT_OF_MEMORY на 'error'-событии родителя), родитель ловит это как обычную
// ошибку и отклоняет импорт. Доказательство выживания процесса: если бы OOM пробил в
// процесс vitest-раннера, эти ассерты никогда бы не выполнились — файл упал бы с крахом,
// а не с пройденной проверкой. Каждый кейс завершается ВАЛИДНОЙ экстракцией — она
// проходит ⇒ процесс пережил бомбу.
describe("worker-изоляция: аллокационная/CPU-бомба НЕ роняет процесс (#20)", () => {
  // Литерал с IIFE, который аллоцирует до OOM при вычислении `({...})` в воркере.
  const MEM_BOMB_LITERAL =
    `const poison = { "x": (function(){ const a = []; while (true) { a.push(new Array(1e6)); } return 1; })() };`;
  // Тело band-функции бомбит при первом же вызове band(0) в harness-цикле extractFunctionTable.
  const MEM_BOMB_FN = `function band(r){ const a = []; while (true) { a.push(new Array(1e6)); } return r; }`;
  // Бесконечный CPU-цикл — ловится vm.timeout ВНУТРИ воркера (не heap, а время).
  const CPU_BOMB_FN = `function band(r){ while (true) {} return r; }`;

  it("память-бомба в литерале: extractData → null, процесс жив", async () => {
    // Воркер умирает по OOM, extractData ловит и штатно отдаёт null — импорт отклонён, не крашнут.
    expect(await extractData(MEM_BOMB_LITERAL, "poison")).toBeNull();
    // Процесс пережил: валидная экстракция сразу после бомбы работает.
    expect(await extractData(`const ok = { "1": "A" };`, "ok")).toEqual({ "1": "A" });
  });

  it("память-бомба в band-функции: extractFunctionTable → null, процесс жив", async () => {
    expect(await extractFunctionTable([MEM_BOMB_FN], "band", 0, 40)).toBeNull();
    // Валидная band-функция после бомбы всё ещё материализуется корректно.
    const ok = await extractFunctionTable(["function band(r){ return r >= 39 ? 9 : 5; }"], "band", 0, 40);
    expect(ok?.[40]).toBe(9);
  });

  it("evalDataObject на бомбе ОТКЛОНЯЕТСЯ ловимой ошибкой (а не фатальным крахом)", async () => {
    // Прямое доказательство «родитель получает catchable-ошибку»: promise reject, не abort процесса.
    const literal = `{ "x": (function(){ const a = []; while (true) { a.push(new Array(1e6)); } return 1; })() }`;
    await expect(evalDataObject(literal)).rejects.toThrow();
    // И процесс продолжает жить.
    expect(await evalDataObject(`{ "ok": true }`)).toEqual({ ok: true });
  });

  it("CPU-бомба: vm.timeout внутри воркера → extractFunctionTable отдаёт null, процесс жив", async () => {
    expect(await extractFunctionTable([CPU_BOMB_FN], "band", 0, 3)).toBeNull();
    expect(await extractData(`const ok = { "1": "A" };`, "ok")).toEqual({ "1": "A" });
  });
});
