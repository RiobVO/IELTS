// @vitest-environment jsdom
// Рендер drop-слота (Inspera Matching Headings / Sentence Endings) в verbatim-панели:
// нативный <select> с канон-значениями, onChange отдаёт канон-value, битые опции не
// роняют панель. JSX не используется (файл .ts под include-паттерн `*.test.ts`);
// монтаж через createElement + React 19 act (см. bridge.test.ts как образец jsdom).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QuestionHtml, parseDropOptions, parseRangeMembers } from "./QuestionHtml";

// React 19 в тесте требует явного флага act-окружения.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { container: HTMLElement; root: Root } | null = null;

function mount(html: string, onAnswer: (n: number, v: string) => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(QuestionHtml, {
        html,
        answers: {},
        onAnswer,
        onToggle: () => {},
        onRangeToggle: () => {},
        fallback: createElement("div", null, "FALLBACK"),
      }),
    );
  });
  mounted = { container, root };
  return container;
}

function mountWith(
  html: string,
  extra: Partial<Parameters<typeof QuestionHtml>[0]>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(QuestionHtml, {
        html,
        answers: {},
        onAnswer: () => {},
        onToggle: () => {},
        onRangeToggle: () => {},
        fallback: createElement("div", null, "FALLBACK"),
        ...extra,
      }),
    );
  });
  mounted = { container, root };
  return container;
}

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

describe("parseDropOptions", () => {
  it("валидный массив → отфильтрованные опции", () => {
    expect(parseDropOptions('[{"v":"A","label":"x"},{"v":"B","label":"y"}]')).toEqual([
      { v: "A", label: "x" },
      { v: "B", label: "y" },
    ]);
  });
  it("undefined / битый JSON / не-массив / пустой → null", () => {
    expect(parseDropOptions(undefined)).toBeNull();
    expect(parseDropOptions("nope")).toBeNull();
    expect(parseDropOptions('{"v":"A"}')).toBeNull();
    expect(parseDropOptions("[]")).toBeNull();
  });
  it("отбрасывает элементы без непустого v; всё невалидно → null", () => {
    expect(parseDropOptions('[{"v":"A","label":"x"},{"bad":1}]')).toEqual([{ v: "A", label: "x" }]);
    expect(parseDropOptions('[{"v":"","label":"x"}]')).toBeNull();
  });
});

describe("QuestionHtml — drop-слот", () => {
  it("рендерит <select> с placeholder + опциями и отдаёт канон-value в onChange", () => {
    const opts = [
      { v: "A", label: "first" },
      { v: "B", label: "second" },
    ];
    const html = `<div class="ending-line"><span class="q-slot" data-q="1" data-qtype="drop" data-options='${JSON.stringify(opts)}'></span></div>`;
    const onAnswer = vi.fn();
    const container = mount(html, onAnswer);

    const select = container.querySelector<HTMLSelectElement>("select.q-drop");
    expect(select).toBeTruthy();
    // placeholder + 2 опции
    expect(select!.querySelectorAll("option")).toHaveLength(3);
    const values = Array.from(select!.querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(["", "A", "B"]);

    act(() => {
      select!.value = "B";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onAnswer).toHaveBeenCalledWith(1, "B");
  });

  it("битые data-options → инертный плейсхолдер, панель не падает (verbatim, не fallback)", () => {
    const html = `<div class="ending-line"><span class="q-slot" data-q="1" data-qtype="drop" data-options='not json'></span></div>`;
    const container = mount(html, vi.fn());
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector(".q-drop-broken")).toBeTruthy();
    // панель отрисовала verbatim (не свалилась в fallback)
    expect(container.textContent).not.toContain("FALLBACK");
  });
});

// choose-TWO group-anchor: второй+ член группы несёт невидимый маркер (физические
// чекбоксы под первым номером). Маркер нужен только чтобы аффордансы и coverage увидели
// его номер — он не интерактивен и не занимает места.
describe("QuestionHtml — choose-TWO group-anchor", () => {
  const groupHtml =
    `<div class="question"><div class="mcq-block">` +
    `<span class="q-slot" data-q="23" data-qtype="checkbox" data-value="A"></span>` +
    `<span class="q-slot" data-q="23" data-qtype="checkbox" data-value="B"></span>` +
    `<span class="q-slot" data-q="24" data-qtype="group-anchor"></span>` +
    `</div></div>`;

  it("group-anchor невидим и не интерактивен (только 2 чекбокса группы)", () => {
    const container = mount(groupHtml, vi.fn());
    // ровно 2 интерактивных чекбокса (по буквам), anchor не даёт третьего контрола
    expect(container.querySelectorAll('[role="checkbox"]')).toHaveLength(2);
    expect(container.querySelectorAll("button")).toHaveLength(2);
    // маркер отрисован, но скрыт (display:none) и aria-hidden
    const anchor = container.querySelector('span[aria-hidden="true"]');
    expect(anchor).toBeTruthy();
    expect((anchor as HTMLElement).style.display).toBe("none");
  });

  it("аффордансы монтируются для ОБОИХ членов группы (23 через чекбоксы, 24 через anchor)", () => {
    const seen: number[] = [];
    const container = mountWith(groupHtml, {
      renderAffordances: (n: number) => {
        seen.push(n);
        return createElement("div", { className: "aff", key: n }, `AFF-${n}`);
      },
    });
    expect(seen).toEqual([23, 24]);
    expect(container.textContent).toContain("AFF-23");
    expect(container.textContent).toContain("AFF-24");
  });
});

// range-checkbox (choose-TWO с ПО-ВОПРОСНЫМИ ключами, Volume 6): checked-стейт галочки
// выводится из значений ВСЕХ членов (буквы розданы позиционно), клик отдаёт
// onRangeToggle(members, letter) — раздача живёт в ExamRunner (rangeGroupToggle).
describe("QuestionHtml — range-checkbox (по-вопросные ключи)", () => {
  const rangeHtml =
    `<div class="question" id="question-25-26"><div class="mcq-checkbox-group">` +
    `<label><span class="q-slot" data-q="25" data-qtype="range-checkbox" data-members="25,26" data-value="A"></span>A</label>` +
    `<label><span class="q-slot" data-q="25" data-qtype="range-checkbox" data-members="25,26" data-value="B"></span>B</label>` +
    `<label><span class="q-slot" data-q="25" data-qtype="range-checkbox" data-members="25,26" data-value="E"></span>E</label>` +
    `</div><span class="q-slot" data-q="26" data-qtype="group-anchor"></span></div>`;

  it("клик отдаёт onRangeToggle с отсортированными членами и буквой", () => {
    const onRangeToggle = vi.fn();
    const container = mountWith(rangeHtml, { onRangeToggle });
    const boxes = container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
    expect(boxes).toHaveLength(3);
    act(() => boxes[2].click());
    expect(onRangeToggle).toHaveBeenCalledWith([25, 26], "E");
  });

  it("checked выводится из ПО-ВОПРОСНЫХ значений членов (25:'B', 26:'E')", () => {
    const container = mountWith(rangeHtml, { answers: { "25": "B", "26": "E" } });
    const boxes = Array.from(container.querySelectorAll('[role="checkbox"]'));
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true", "true"]);
  });

  it("аффордансы монтируются для обоих членов (25 через слоты, 26 через anchor)", () => {
    const seen: number[] = [];
    const container = mountWith(rangeHtml, {
      renderAffordances: (n: number) => {
        seen.push(n);
        return createElement("div", { className: "aff", key: n }, `AFF-${n}`);
      },
    });
    expect(seen.sort()).toEqual([25, 26]);
    expect(container.textContent).toContain("AFF-25");
    expect(container.textContent).toContain("AFF-26");
  });

  it("битые data-members → инертный плейсхолдер, панель не падает", () => {
    const broken =
      `<div class="question"><span class="q-slot" data-q="25" data-qtype="range-checkbox" data-members="25" data-value="A"></span></div>`;
    const container = mountWith(broken, {});
    expect(container.querySelector('[role="checkbox"]')).toBeNull();
    expect(container.querySelector(".q-drop-broken")).toBeTruthy();
    expect(container.textContent).not.toContain("FALLBACK");
  });
});

describe("parseRangeMembers", () => {
  it("валидная пара → отсортированные номера", () => {
    expect(parseRangeMembers("25,26")).toEqual([25, 26]);
    expect(parseRangeMembers("26,25")).toEqual([25, 26]);
  });
  it("undefined / один номер / мусор / дубликаты / не-положительные → null", () => {
    expect(parseRangeMembers(undefined)).toBeNull();
    expect(parseRangeMembers("25")).toBeNull();
    expect(parseRangeMembers("a,b")).toBeNull();
    expect(parseRangeMembers("25,25")).toBeNull();
    expect(parseRangeMembers("0,-1")).toBeNull();
  });
});

// Listening verbatim (проводка fix 0 в ExamRunner): capture-listening отдаёт те же
// q-slot-типы (text/radio/checkbox/drop/group-anchor), что и reading-захват — одна и та
// же QuestionHtml обслуживает обе секции. Проверяем, что каждый listening-механизм
// проходит через ветку Slot и рендерит интерактивный контрол (а не сваливается в fallback).
describe("QuestionHtml — listening q-slot типы", () => {
  it("gap(text) / radio / map-drop рендерятся как интерактивные контролы", () => {
    const html =
      `<div class="form-box"><span class="q-slot" data-q="1" data-qtype="text"></span></div>` +
      `<div class="mcq"><span class="q-slot" data-q="2" data-qtype="radio" data-value="A"></span>` +
      `<span class="q-slot" data-q="2" data-qtype="radio" data-value="B"></span></div>` +
      `<div class="lst-map-line"><span class="q-slot" data-q="15" data-qtype="drop" data-options='[{"v":"A","label":"Building A"}]'></span></div>`;
    const container = mount(html, vi.fn());
    expect(container.querySelector("input.q-text")).toBeTruthy();
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(2);
    expect(container.querySelector("select.q-drop")).toBeTruthy();
    expect(container.textContent).not.toContain("FALLBACK");
  });
});

// Размещение practice-аффордансов (2026-07-26). До фикса они монтировались только
// пачкой ПОСЛЕ top-level блока: у канона клиента группа из шести вопросов — один блок,
// поэтому шесть карточек «QUESTION N» сваливались в конец, оторванные от вопросов.
// Теперь аффорданс живёт внутри контейнера своего вопроса, а кластер остаётся лишь для
// вёрстки, куда блок не вставить (таблицы/списки).
describe("QuestionHtml — размещение аффордансов", () => {
  const aff = (seen: number[]) => (n: number) => {
    seen.push(n);
    return createElement("div", { className: "aff", key: n }, `AFF-${n}`);
  };

  // Канон клиента: группа-обёртка + по контейнеру `#question-N` на каждый вопрос.
  const insperaGroup =
    `<div class="question" id="question-group-1-3">` +
    `<div class="question-rubric">Questions 1-3</div>` +
    `<div class="question-content">` +
    `<div class="tfng-question" id="question-1"><p>Statement one</p>` +
    `<span class="q-slot" data-q="1" data-qtype="radio" data-value="TRUE"></span>` +
    `<span class="q-slot" data-q="1" data-qtype="radio" data-value="FALSE"></span></div>` +
    `<div class="tfng-question" id="question-2"><p>Statement two</p>` +
    `<span class="q-slot" data-q="2" data-qtype="radio" data-value="TRUE"></span></div>` +
    `<div class="tfng-question" id="question-3"><p>Statement three</p>` +
    `<span class="q-slot" data-q="3" data-qtype="radio" data-value="TRUE"></span></div>` +
    `</div></div>`;

  it("аффорданс лежит ВНУТРИ контейнера своего вопроса, а не кучей в конце", () => {
    const seen: number[] = [];
    const container = mountWith(insperaGroup, { renderAffordances: aff(seen) });

    for (const n of [1, 2, 3]) {
      const box = container.querySelector(`#question-${n}`);
      expect(box?.textContent).toContain(`AFF-${n}`);
      // и ровно один — соседние вопросы свой аффорданс не притащили
      expect(box?.querySelectorAll(".aff")).toHaveLength(1);
    }
    expect(container.querySelector(".qa-cluster")).toBeNull();
    expect(seen.sort()).toEqual([1, 2, 3]);
  });

  it("порядок в DOM: каждый аффорданс идёт за своим вопросом, а не после всей группы", () => {
    const container = mountWith(insperaGroup, { renderAffordances: aff([]) });
    const order = Array.from(container.querySelectorAll("[id^='question-'], .aff")).map((el) =>
      el.classList.contains("aff") ? el.textContent : el.id,
    );
    expect(order).toEqual([
      "question-group-1-3",
      "question-1", "AFF-1",
      "question-2", "AFF-2",
      "question-3", "AFF-3",
    ]);
  });

  it("аффорданс садится на САМЫЙ ВЕРХНИЙ контейнер вопроса, не на вложенный вариант ответа", () => {
    const nested =
      `<div class="question"><div class="tfng-question" id="question-1">` +
      `<label class="opt"><span class="q-slot" data-q="1" data-qtype="radio" data-value="TRUE"></span>TRUE</label>` +
      `<label class="opt"><span class="q-slot" data-q="1" data-qtype="radio" data-value="FALSE"></span>FALSE</label>` +
      `</div></div>`;
    const container = mountWith(nested, { renderAffordances: aff([]) });
    expect(container.querySelectorAll(".aff")).toHaveLength(1);
    expect(container.querySelector("label.opt .aff")).toBeNull();
  });

  // Внутрь <tr> блок не положить — карточка идёт СЛЕДУЮЩЕЙ строкой во всю ширину
  // (matching-таблица: строка = вопрос). Раньше такие карточки сваливались кучей под
  // таблицу — именно это было видно на «How to be Happy» (вопросы 14–17).
  const matchingTable =
    `<div class="question"><table class="matching-table"><thead>` +
    `<tr><th>Statement</th><th>A</th><th>B</th></tr></thead><tbody>` +
    `<tr><td>14 first</td><td><span class="q-slot" data-q="14" data-qtype="radio" data-value="A"></span></td>` +
    `<td><span class="q-slot" data-q="14" data-qtype="radio" data-value="B"></span></td></tr>` +
    `<tr><td>15 second</td><td><span class="q-slot" data-q="15" data-qtype="radio" data-value="A"></span></td>` +
    `<td><span class="q-slot" data-q="15" data-qtype="radio" data-value="B"></span></td></tr>` +
    `</tbody></table></div>`;

  it("строка таблицы: аффорданс идёт отдельной строкой сразу под своим вопросом", () => {
    const container = mountWith(matchingTable, { renderAffordances: aff([]) });
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    // порядок: вопрос 14 → его карточка → вопрос 15 → его карточка
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain("14 first");
    expect(rows[1].className).toBe("qa-row");
    expect(rows[1].textContent).toBe("AFF-14");
    expect(rows[2].textContent).toContain("15 second");
    expect(rows[3].textContent).toBe("AFF-15");
    expect(container.querySelector(".qa-cluster")).toBeNull(); // кучи больше нет
  });

  it("служебная строка растянута на все колонки таблицы", () => {
    const container = mountWith(matchingTable, { renderAffordances: aff([]) });
    const cell = container.querySelector(".qa-row > td") as HTMLTableCellElement;
    expect(cell.colSpan).toBe(3); // Statement + A + B
  });

  it("заголовок таблицы (thead) карточку не получает", () => {
    const container = mountWith(matchingTable, { renderAffordances: aff([]) });
    expect(container.querySelector("thead .aff")).toBeNull();
    expect(container.querySelectorAll(".aff")).toHaveLength(2);
  });

  it("ячейка не становится якорем — карточка не лезет внутрь узкой колонки", () => {
    const container = mountWith(matchingTable, { renderAffordances: aff([]) });
    for (const el of Array.from(container.querySelectorAll(".aff"))) {
      expect(el.closest("tr")?.className).toBe("qa-row");
    }
  });

  it("смешанный блок: свой контейнер — инлайн, строка таблицы — своей строкой (без дублей)", () => {
    const mixed =
      `<div class="question">` +
      `<div class="tfng-question" id="question-1"><span class="q-slot" data-q="1" data-qtype="radio" data-value="TRUE"></span></div>` +
      `<table><tbody><tr><td><span class="q-slot" data-q="2" data-qtype="radio" data-value="A"></span></td></tr></tbody></table>` +
      `</div>`;
    const container = mountWith(mixed, { renderAffordances: aff([]) });
    expect(container.querySelector("#question-1 .aff")?.textContent).toBe("AFF-1");
    expect(container.querySelector(".qa-row")?.textContent).toBe("AFF-2");
    expect(container.querySelector(".qa-cluster")).toBeNull();
    expect(container.querySelectorAll(".aff")).toHaveLength(2); // ни одного дубля
  });

  it("строка без вопроса служебной строки не порождает", () => {
    // Два вопроса в таблице (иначе весь блок — «один вопрос» и якорь сядет на него),
    // плюс строка-подпись без слотов: она карточку получить не должна.
    const withCaption =
      `<div class="question"><table><tbody>` +
      `<tr><td colspan="2">Section caption</td></tr>` +
      `<tr><td>9</td><td><span class="q-slot" data-q="9" data-qtype="text"></span></td></tr>` +
      `<tr><td>10</td><td><span class="q-slot" data-q="10" data-qtype="text"></span></td></tr>` +
      `</tbody></table></div>`;
    const container = mountWith(withCaption, { renderAffordances: aff([]) });
    expect(container.querySelectorAll(".qa-row")).toHaveLength(2); // по одной на вопрос
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(rows[0].className).not.toBe("qa-row"); // подпись осталась без карточки
    expect(rows[0].textContent).toContain("Section caption");
  });

  it("одинокий вопрос в блоке: якорь садится на блок, лишней строки в таблице нет", () => {
    const single =
      `<div class="question"><table><tbody>` +
      `<tr><td><span class="q-slot" data-q="9" data-qtype="text"></span></td></tr>` +
      `</tbody></table></div>`;
    const container = mountWith(single, { renderAffordances: aff([]) });
    expect(container.querySelectorAll(".aff")).toHaveLength(1);
    expect(container.querySelector(".qa-cluster")).toBeNull();
  });

  it("mock (без renderAffordances): разметка без аффордансов и без пустых узлов", () => {
    const container = mount(insperaGroup, vi.fn());
    expect(container.querySelectorAll(".aff")).toHaveLength(0);
    expect(container.querySelector(".qa-cluster")).toBeNull();
    expect(container.querySelector("#question-1")).toBeTruthy(); // вёрстка цела
  });
});

describe("map-embed (.lst-map-embed → sandbox-iframe)", () => {
  const embedHtml =
    `<div class="map-layout">` +
    `<div class="lst-map-embed" data-map-doc="<!doctype html><html><body><div class=&quot;mp&quot;>MAP-MARKER</div></body></html>"></div>` +
    `<div class="mcq"><span class="q-slot" data-q="11" data-qtype="radio" data-value="A"></span></div>` +
    `</div>`;

  it("рендерится iframe: sandbox без allow-scripts, srcdoc несёт документ карты", () => {
    const container = mount(embedHtml, vi.fn());
    const frame = container.querySelector("iframe.q-map-embed") as HTMLIFrameElement | null;
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame?.getAttribute("srcdoc")).toContain("MAP-MARKER");
    // слот рядом живёт как обычно
    expect(container.querySelector('[role="radio"]')).toBeTruthy();
  });

  it("embed без data-map-doc → узел молча пропускается, панель не падает", () => {
    const container = mount(
      `<div class="lst-map-embed"></div><span class="q-slot" data-q="1" data-qtype="text"></span>`,
      vi.fn(),
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("input.q-text")).toBeTruthy();
  });
});
