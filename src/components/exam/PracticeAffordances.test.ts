// @vitest-environment jsdom
// Гейт пустой карточки: со снятой «Strategy» (2026-07-26) у неотвеченного вопроса без
// локатора внутри карточки не остаётся ничего, и панель практис заполнялась пустыми
// серыми плашками «Question N». Проверяем, когда карточка рисуется, а когда нет.
// JSX не используется (файл .ts под include-паттерн `*.test.ts`) — монтаж через
// createElement + React 19 act, как в QuestionHtml.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PracticeAffordances } from "./PracticeAffordances";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { container: HTMLElement; root: Root } | null = null;

type Props = Parameters<typeof PracticeAffordances>[0];

const BASE: Props = {
  q: { number: 7, qtype: "tfng", prompt_html: "Statement", options: null },
  value: "",
  verdict: undefined,
  reveal: undefined,
  checkBusy: false,
  wrongTry: 0,
  canLocate: false,
  onCheck: vi.fn(),
  onReveal: vi.fn(),
  onConfidence: vi.fn(),
  showNumber: true,
};

function mount(extra: Partial<Props>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(PracticeAffordances, { ...BASE, ...extra }));
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

describe("PracticeAffordances — когда карточка вообще рисуется", () => {
  it("вопрос без ответа и без локатора: карточки нет (не пустая плашка)", () => {
    expect(mount({}).innerHTML).toBe("");
  });

  it("есть ответ → карточка с проверкой", () => {
    const container = mount({ value: "TRUE" });
    expect(container.querySelector(".qa-item")).toBeTruthy();
    expect(container.textContent).toContain("Question 7");
    expect(container.textContent).toContain("Check");
  });

  it("нет ответа, но есть локатор → карточка с «Where to look?»", () => {
    const container = mount({ canLocate: true, onWhereToLook: vi.fn(async () => true) });
    expect(container.querySelector(".qa-item")).toBeTruthy();
    expect(container.textContent).toContain("Where to look");
  });

  it("после раскрытия ключа локатор скрыт — без ответа карточка исчезает", () => {
    const container = mount({
      canLocate: true,
      onWhereToLook: vi.fn(async () => true),
      reveal: { accept: ["TRUE"], explanation: null, explanationRu: null, evidence: null },
    });
    expect(container.innerHTML).toBe("");
  });

  it("«Strategy» больше не рендерится ни при каких условиях", () => {
    const container = mount({
      value: "TRUE",
      canLocate: true,
      onWhereToLook: vi.fn(async () => true),
    });
    expect(container.textContent).not.toContain("Strategy");
    expect(container.querySelector(".exam-strategy")).toBeNull();
  });
});
