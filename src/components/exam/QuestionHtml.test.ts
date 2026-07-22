// @vitest-environment jsdom
// Рендер drop-слота (Inspera Matching Headings / Sentence Endings) в verbatim-панели:
// нативный <select> с канон-значениями, onChange отдаёт канон-value, битые опции не
// роняют панель. JSX не используется (файл .ts под include-паттерн `*.test.ts`);
// монтаж через createElement + React 19 act (см. bridge.test.ts как образец jsdom).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QuestionHtml, parseDropOptions } from "./QuestionHtml";

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
