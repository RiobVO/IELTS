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
