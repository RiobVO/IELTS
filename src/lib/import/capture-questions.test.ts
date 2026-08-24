import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { captureQuestions } from "./capture-questions";
import { extractHeadingBank, extractHeadingTargets } from "./dnd-capture";
import type { CaptureDnd } from "./dnd-capture";

const EMPTY_DND: CaptureDnd = { headingTargets: [], headingBank: [], endingBank: [] };

describe("captureQuestions answer-key hygiene", () => {
  // Утечка ключа №1 (BRIEF §4.2/§6.1): захваченный HTML вопрос-панели рендерится
  // на клиенте (QuestionHtml реэмитит все атрибуты). Источник несёт правильный
  // ответ в data-correct (parse-reading-full читает его со .mc-question[data-mcq-group]).
  // Он ОБЯЗАН быть вырезан до попадания в клиент.
  it("вырезает answer-bearing атрибуты (data-correct и т.п.)", () => {
    const block =
      `<div class="mc-question" data-mcq-group="1-2" data-correct="A,C">` +
      `<div class="tfng-statement-text">Pick two</div>` +
      `<label><input type="checkbox" name="q1" value="A">A</label>` +
      `<label><input type="checkbox" name="q2" value="B">B</label>` +
      `</div>`;
    const out = captureQuestions([block]);
    expect(out).not.toBe(""); // маппится → verbatim-путь включён
    expect(out).not.toMatch(/data-correct/i);
    expect(out).not.toMatch(/data-answer/i);
    // сам вопрос сохранён
    expect(out).toMatch(/Pick two/);
  });

  // Inspera Style источник (2026-07-21): `.analysis`/`[data-analysis]` несёт
  // ПРАВИЛЬНЫЙ ОТВЕТ в тексте (скрыт только исходным CSS `.analysis{display:none}`,
  // который verbatim-захват не переносит) — обязан вырезаться целиком.
  it("вырезает .analysis (Inspera-style answer-reveal блок)", () => {
    const block =
      `<div class="tfng-question" id="question-1">` +
      `<label><input type="radio" name="q1" value="TRUE">TRUE</label>` +
      `<label><input type="radio" name="q1" value="FALSE">FALSE</label>` +
      `<div class="analysis" data-analysis="1">Q1 — evidence text. <strong>TRUE</strong>.</div>` +
      `</div>`;
    const out = captureQuestions([block]);
    expect(out).not.toBe("");
    expect(out).not.toMatch(/analysis/i);
    expect(out).not.toMatch(/evidence text/i);
  });

  it("не трогает безопасные data-атрибуты, нужные рендеру (data-mcq-group)", () => {
    const block =
      `<div class="mc-question" data-mcq-group="1-2">` +
      `<label><input type="checkbox" name="q1" value="A">A</label>` +
      `<label><input type="checkbox" name="q2" value="B">B</label>` +
      `</div>`;
    const out = captureQuestions([block]);
    expect(out).toMatch(/data-mcq-group/);
  });
});

describe("captureQuestions — drag-and-drop (Inspera Matching Headings / Sentence Endings)", () => {
  const endingBlock =
    `<div class="question" id="question-group-1-2">` +
    `<div class="ending-line" id="question-1"><span class="q-num-box">1</span><span class="ending-stmt">Stem one</span><div class="ending-drop" id="drop-q1" data-q="1"><span class="placeholder">A–F</span></div></div>` +
    `<div class="ending-line" id="question-2"><span class="q-num-box">2</span><span class="ending-stmt">Stem two</span><div class="ending-drop" id="drop-q2" data-q="2"><span class="placeholder">A–F</span></div></div>` +
    `<div class="ending-bank"><div class="ending-slot" data-ending="A"><div class="ending-token" draggable="true" tabindex="0" data-ending="A"><b>A</b> first ending.</div></div></div>` +
    `</div>`;
  const endingBank = [
    { v: "A", label: "first ending." },
    { v: "B", label: "second ending." },
  ];

  it("endings: каждая .ending-drop → drop-слот с канон-опциями; банк остаётся инертным", () => {
    const out = captureQuestions([endingBlock], { ...EMPTY_DND, endingBank });
    expect(out).not.toBe("");
    expect((out.match(/data-qtype="drop"/g) ?? []).length).toBe(2);
    expect(out).toContain(`data-q="1"`);
    expect(out).toContain(`data-q="2"`);
    // цели заменены (не осталось .ending-drop)
    expect(out).not.toContain("ending-drop");
    // банк-референс сохранён, но без интерактивности
    expect(out).toContain("ending-token");
    expect(out).not.toContain("draggable");
    expect(out).not.toContain("tabindex");
    // канон-значения именно v (паритет с мостом/грейдингом)
    const $ = load(out, null, false);
    const opts = JSON.parse($(".q-slot[data-q='1']").attr("data-options") ?? "[]");
    expect(opts).toEqual(endingBank);
  });

  it("headings: синтез строк «Question N — Paragraph X» + drop-слоты", () => {
    const headingBlock =
      `<div class="question" id="question-group-1-2">` +
      `<div class="question-rubric"><h3>Questions 1–2</h3></div>` +
      `<div class="heading-bank"><div class="heading-slot" data-heading="i"><div class="heading-token" draggable="true" data-heading="i"><span>i</span> First heading</div></div></div>` +
      `</div>`;
    const out = captureQuestions([headingBlock], {
      headingTargets: [
        { number: 1, paragraph: "A" },
        { number: 2, paragraph: "B" },
      ],
      headingBank: [
        { v: "i", label: "First heading" },
        { v: "ii", label: "Second heading" },
      ],
      endingBank: [],
    });
    expect(out).toContain("Paragraph A");
    expect(out).toContain("Paragraph B");
    expect((out.match(/data-qtype="drop"/g) ?? []).length).toBe(2);
    expect(out).toContain(`data-q="1"`);
    expect(out).toContain(`data-q="2"`);
  });

  it("endings без банка → fail-closed", () => {
    expect(captureQuestions([endingBlock], { ...EMPTY_DND, endingBank: [] })).toBe("");
  });

  it("банк с пустым канон-значением → fail-closed", () => {
    expect(
      captureQuestions([endingBlock], { ...EMPTY_DND, endingBank: [{ v: "", label: "x" }] }),
    ).toBe("");
  });

  it("дубль номеров DnD → fail-closed", () => {
    const dup =
      `<div class="ending-line"><div class="ending-drop" data-q="1"></div></div>` +
      `<div class="ending-line"><div class="ending-drop" data-q="1"></div></div>`;
    expect(captureQuestions([dup], { ...EMPTY_DND, endingBank: [{ v: "A", label: "x" }] })).toBe("");
  });

  it("heading-цель без буквы абзаца → fail-closed", () => {
    const block = `<div class="heading-bank"><div class="heading-token" data-heading="i">i x</div></div>`;
    expect(
      captureQuestions([block], {
        headingTargets: [{ number: 1, paragraph: "" }],
        headingBank: [{ v: "i", label: "x" }],
        endingBank: [],
      }),
    ).toBe("");
  });

  it("незаменённая .ending-drop (без data-q) → fail-closed, даже при валидных слотах", () => {
    const block =
      `<div class="ending-line"><div class="ending-drop"></div></div>` +
      `<div class="heading-bank"><div class="heading-token" data-heading="i">i x</div></div>`;
    const out = captureQuestions([block], {
      headingTargets: [{ number: 1, paragraph: "A" }],
      headingBank: [{ v: "i", label: "x" }],
      endingBank: [],
    });
    expect(out).toBe("");
  });

  it("legacy drag-drop (.dd-drop / [data-dropzone] / .dropzone) по-прежнему bail (пин)", () => {
    expect(captureQuestions([`<div class="dd-drop" data-q="1"></div>`])).toBe("");
    expect(
      captureQuestions([`<div data-dropzone="1"></div><input type="text" name="q1">`]),
    ).toBe("");
    expect(captureQuestions([`<div class="dropzone"></div><input type="text" name="q1">`])).toBe("");
  });

  it("новая DnD-ветка тоже вырезает .analysis и answer-атрибуты", () => {
    const block =
      `<div class="question">` +
      `<div class="ending-line"><div class="ending-drop" data-q="1"></div></div>` +
      `<div class="analysis" data-analysis="1">The answer is A</div>` +
      `<div class="ending-bank" data-correct="A"><div class="ending-token" data-ending="A"><b>A</b> x</div></div>` +
      `</div>`;
    const out = captureQuestions([block], { ...EMPTY_DND, endingBank: [{ v: "A", label: "x" }] });
    expect(out).not.toBe("");
    expect(out).not.toMatch(/analysis/i);
    expect(out).not.toMatch(/The answer is A/);
    expect(out).not.toMatch(/data-correct/i);
  });

  it("data-options round-trip спецсимволов (\" & < юникод) — ровно один уровень эскейпинга", () => {
    const block = `<div class="ending-line"><div class="ending-drop" data-q="1"></div></div>`;
    const endingBankSpecial = [{ v: "A", label: 'has "quotes" & <b>markup</b> café δ' }];
    const out = captureQuestions([block], { ...EMPTY_DND, endingBank: endingBankSpecial });
    const $ = load(out, null, false);
    // cheerio .attr() декодирует ровно один уровень → JSON.parse обязан пройти
    const parsed = JSON.parse($(".q-slot[data-q='1']").attr("data-options") ?? "[]");
    expect(parsed).toEqual(endingBankSpecial);
  });
});

// Фиксы ревью Codex (fix-then-approve): утечка ключа через label банка, потеря
// heading-цели без data-q, переполнение data-q.
describe("captureQuestions — leak / edge fixes", () => {
  it("Блокер 1: .analysis внутри токена банка НЕ утекает в data-options label", () => {
    const bankHtml =
      `<div class="heading-bank">` +
      `<div class="heading-token" data-heading="i">i Safe label<span class="analysis">CORRECT_FOR_Q14=iii</span></div>` +
      `</div>`;
    // extractHeadingBank чистит leak-узлы токена ДО извлечения текста
    const bank = extractHeadingBank(load(bankHtml, null, false));
    expect(bank).toEqual([{ v: "i", label: "Safe label" }]);
    // и сквозной путь: capture кладёт очищенный label в data-options
    const out = captureQuestions([bankHtml], {
      headingTargets: [{ number: 14, paragraph: "A" }],
      headingBank: bank,
      endingBank: [],
    });
    expect(out).not.toMatch(/CORRECT_FOR_Q14/);
    expect(out).not.toMatch(/analysis/i);
  });

  it("Блокер 2: heading-цель без data-q → fail-closed (частичный капчер не проходит)", () => {
    const $p = load(
      `<div id="passageContent"><div class="heading-drop-line" id="heading-line-A">` +
        `<div class="heading-drop"><span class="placeholder">14</span></div></div></div>`,
      null,
      false,
    );
    const targets = extractHeadingTargets($p, $p("#passageContent"));
    expect(targets).toHaveLength(1);
    expect(Number.isNaN(targets[0]!.number)).toBe(true);
    const block =
      `<div class="question"><p>The gas is <input type="text" name="q2"></p>` +
      `<div class="heading-bank"><div class="heading-token" data-heading="i">i x</div></div></div>`;
    const out = captureQuestions([block], {
      headingTargets: targets,
      headingBank: [{ v: "i", label: "x" }],
      endingBank: [],
    });
    expect(out).toBe("");
  });

  it("Блокер 2b: банк headings есть, а целей ноль → fail-closed", () => {
    const block = `<div class="heading-bank"><div class="heading-token" data-heading="i">i x</div></div>`;
    const out = captureQuestions([block], {
      headingTargets: [],
      headingBank: [{ v: "i", label: "x" }],
      endingBank: [],
    });
    expect(out).toBe("");
  });

  it("Блокер 3: 400-значный data-q (parseInt → Infinity) → fail-closed", () => {
    const huge = "9".repeat(400);
    const block = `<div class="ending-line"><div class="ending-drop" data-q="${huge}"></div></div>`;
    const out = captureQuestions([block], { ...EMPTY_DND, endingBank: [{ v: "A", label: "x" }] });
    expect(out).toBe("");
  });
});
