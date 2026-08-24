import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { captureQuestions } from "./capture-questions";
import { extractHeadingBank, extractHeadingTargets } from "./dnd-capture";
import type { CaptureDnd } from "./dnd-capture";
import { questionsHtmlCoversAll } from "../exam/question-html-coverage";

const EMPTY_DND: CaptureDnd = { headingTargets: [], headingBank: [], endingBank: [] };

// choose-TWO/THREE (Inspera .mcq-block[data-mcq-group]): физические чекбоксы одного
// блока делят group_key; сервер грейдит каждого члена полным набором (mcq_set). Захват
// обязан покрыть КАЖДОГО члена слотом — иначе coverage-гейт (questionsHtmlCoversAll)
// откатывает practice-verbatim в атомизацию (баг: раньше ancestor-фоллбэк num() кеил все
// чекбоксы на первое число id группы, второй член терял слот).
describe("captureQuestions — choose-TWO/THREE (.mcq-block[data-mcq-group])", () => {
  // Разметка «Passage 2 Population» (7228-7236): все чекбоксы name="mcq-23-24", номера
  // только на чипах .mcq-q-num-box, data-correct на блоке.
  const groupBlock = (group: string, nums: number[], letters: string[], correct = "") =>
    `<div class="question" id="question-group-${group}">` +
    `<div class="question-rubric"><p>Choose <strong>TWO</strong> letters.</p></div>` +
    `<div class="question-content">` +
    `<div class="mcq-block" data-mcq-group="${group}"${correct ? ` data-correct="${correct}"` : ""}>` +
    `<div class="mcq-q-labels">${nums.map((n) => `<span class="mcq-q-num-box">${n}</span>`).join("")}</div>` +
    `<div class="mcq-options">` +
    letters
      .map(
        (v) =>
          `<label class="mcq-row"><input type="checkbox" name="mcq-${group}" value="${v}"><span class="mcq-letter">${v}</span><span>opt ${v}</span></label>`,
      )
      .join("") +
    `</div></div></div></div>`;

  it("оба члена покрыты: checkbox-слоты на первом номере + group-anchor на втором", () => {
    const out = captureQuestions([groupBlock("23-24", [23, 24], ["A", "B", "C", "D", "E"], "A,E")]);
    expect(out).not.toBe("");
    expect(questionsHtmlCoversAll(out, [23, 24])).toBe(true);
    const $ = load(out, null, false);
    // 5 checkbox-слотов, все на первом номере 23; ни одного на 24
    expect($('.q-slot[data-qtype="checkbox"]').length).toBe(5);
    expect($('.q-slot[data-qtype="checkbox"][data-q="23"]').length).toBe(5);
    expect($('.q-slot[data-qtype="checkbox"][data-q="24"]').length).toBe(0);
    // ровно один group-anchor — второй член
    expect($('.q-slot[data-qtype="group-anchor"]').length).toBe(1);
    expect($('.q-slot[data-qtype="group-anchor"][data-q="24"]').length).toBe(1);
    // канон-буквы сохранены на слотах
    expect($('.q-slot[data-qtype="checkbox"][data-value="E"]').length).toBe(1);
  });

  it("номера из ЧИПОВ, не из парса диапазона: '8-12' с 5 чипами покрывает 8..12", () => {
    const out = captureQuestions([
      groupBlock("8-12", [8, 9, 10, 11, 12], ["A", "B", "C", "D", "E", "F"]),
    ]);
    expect(out).not.toBe("");
    expect(questionsHtmlCoversAll(out, [8, 9, 10, 11, 12])).toBe(true);
    const $ = load(out, null, false);
    // первый = 8: чекбоксы на 8, anchors на 9..12
    expect($('.q-slot[data-qtype="checkbox"][data-q="8"]').length).toBe(6);
    expect($('.q-slot[data-qtype="group-anchor"]').length).toBe(4);
  });

  it("data-correct блока вычищен (анти-утечка ключа)", () => {
    const out = captureQuestions([groupBlock("23-24", [23, 24], ["A", "B"], "A,B")]);
    expect(out).not.toMatch(/data-correct/i);
  });

  it("обычный choose-ONE не задет: две группы в одном пассаже покрыты обе", () => {
    const out = captureQuestions([
      groupBlock("23-24", [23, 24], ["A", "B", "C"], "A,C"),
      groupBlock("25-26", [25, 26], ["A", "B", "C"], "B,C"),
    ]);
    expect(questionsHtmlCoversAll(out, [23, 24, 25, 26])).toBe(true);
  });

  describe("fail-closed → '' на весь пассаж", () => {
    it("блок без чекбоксов", () => {
      const block =
        `<div class="mcq-block" data-mcq-group="1-2">` +
        `<div class="mcq-q-labels"><span class="mcq-q-num-box">1</span><span class="mcq-q-num-box">2</span></div>` +
        `</div>`;
      expect(captureQuestions([block])).toBe("");
    });
    it("<2 уникальных валидных чипа", () => {
      expect(captureQuestions([groupBlock("4-4", [4], ["A", "B"])])).toBe("");
    });
    it("дублирующийся value чекбокса", () => {
      expect(captureQuestions([groupBlock("4-5", [4, 5], ["A", "A"])])).toBe("");
    });
    it("пустой value чекбокса", () => {
      expect(captureQuestions([groupBlock("4-5", [4, 5], ["A", ""])])).toBe("");
    });
    it("номер группы пересекается с другой группой", () => {
      const out = captureQuestions([
        groupBlock("4-5", [4, 5], ["A", "B"]),
        groupBlock("5-6", [5, 6], ["A", "B"]),
      ]);
      expect(out).toBe("");
    });
    it("номер группы пересекается с одиночным text-вопросом", () => {
      const single = `<div class="question" id="question-4"><p>Gap <input type="text" name="q4"></p></div>`;
      expect(captureQuestions([groupBlock("4-5", [4, 5], ["A", "B"]), single])).toBe("");
    });
    it("unsafe номер чипа (400-значный) отсекается → <2 валидных → fail", () => {
      const huge = "9".repeat(400);
      const block =
        `<div class="mcq-block" data-mcq-group="x">` +
        `<div class="mcq-q-labels"><span class="mcq-q-num-box">${huge}</span><span class="mcq-q-num-box">4</span></div>` +
        `<label class="mcq-row"><input type="checkbox" name="mcq-x" value="A"></label>` +
        `<label class="mcq-row"><input type="checkbox" name="mcq-x" value="B"></label>` +
        `</div>`;
      expect(captureQuestions([block])).toBe("");
    });
    it("чекбокс в блоке ВНЕ .mcq-row (расходится с атомайзером) → fail-closed", () => {
      const block =
        `<div class="mcq-block" data-mcq-group="4-5">` +
        `<div class="mcq-q-labels"><span class="mcq-q-num-box">4</span><span class="mcq-q-num-box">5</span></div>` +
        `<label class="mcq-row"><input type="checkbox" name="mcq-4-5" value="A"></label>` +
        `<label class="mcq-row"><input type="checkbox" name="mcq-4-5" value="B"></label>` +
        // паразитный чекбокс вне .mcq-row — атомайзер (optionsIn по .mcq-row) его не читает
        `<label class="mcq-extra"><input type="checkbox" name="mcq-4-5" value="C"></label>` +
        `</div>`;
      expect(captureQuestions([block])).toBe("");
    });
    it("нет чекбоксов внутри .mcq-row (все вне) → fail-closed", () => {
      const block =
        `<div class="mcq-block" data-mcq-group="4-5">` +
        `<div class="mcq-q-labels"><span class="mcq-q-num-box">4</span><span class="mcq-q-num-box">5</span></div>` +
        `<label class="mcq-extra"><input type="checkbox" name="mcq-4-5" value="A"></label>` +
        `<label class="mcq-extra"><input type="checkbox" name="mcq-4-5" value="B"></label>` +
        `</div>`;
      expect(captureQuestions([block])).toBe("");
    });
    it("чекбокс с собственным name=qN (индивидуально ключенный) → неоднозначно", () => {
      const block =
        `<div class="mcq-block" data-mcq-group="4-5">` +
        `<div class="mcq-q-labels"><span class="mcq-q-num-box">4</span><span class="mcq-q-num-box">5</span></div>` +
        `<label class="mcq-row"><input type="checkbox" name="q4" value="A"></label>` +
        `<label class="mcq-row"><input type="checkbox" name="q5" value="B"></label>` +
        `</div>`;
      expect(captureQuestions([block])).toBe("");
    });
  });

  it("обычные radio-опции одного вопроса (общий номер) НЕ регрессируют", () => {
    // radio-блок: 3 инпута name='q1' → 3 radio-слота data-q=1 (легитимный общий номер).
    const block =
      `<div class="tfng-question" id="question-1">` +
      `<label><input type="radio" name="q1" value="TRUE">TRUE</label>` +
      `<label><input type="radio" name="q1" value="FALSE">FALSE</label>` +
      `<label><input type="radio" name="q1" value="NOT GIVEN">NG</label>` +
      `</div>`;
    const out = captureQuestions([block]);
    expect(out).not.toBe("");
    const $ = load(out, null, false);
    expect($('.q-slot[data-qtype="radio"][data-q="1"]').length).toBe(3);
    expect(questionsHtmlCoversAll(out, [1])).toBe(true);
  });
});

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

// B1 (адверсариальное ревью): denylist-стрип (stripCapturedLeaks) вычищал лишь
// `.analysis`/`[data-analysis]`; альтернативный reveal-маркер под чужим классом
// (`<div class="correct-answer">Correct answer: …</div>`) переживал гигиену и утекал в
// practice. Детектор class-токенов уводит такой пассаж в атомизацию (fail-closed) + warning.
describe("captureQuestions — reveal-marker fail-closed (B1)", () => {
  it("чужой reveal-класс рядом с валидным инпутом → '' + onLeak(токен)", () => {
    const leaks: string[] = [];
    const block =
      `<div class="question" id="question-1">` +
      `<input type="text" name="q1">` +
      `<div class="correct-answer">Correct answer: PIZZA</div>` +
      `</div>`;
    const out = captureQuestions([block], undefined, (t) => leaks.push(t));
    expect(out).toBe("");
    expect(leaks).toEqual(["correct-answer"]);
  });

  // Нормализация (регистр + разделители) и id-вектор.
  it.each([
    ["class", "Correct-Answer"],
    ["class", "correctAnswer"],
    ["class", "correct_answer"],
    ["id", "correct-answer"],
  ])("reveal-маркер под %s='%s' → fail-closed + onLeak(исходный токен)", (attr, val) => {
    const leaks: string[] = [];
    const block =
      `<div class="question" id="question-1">` +
      `<input type="text" name="q1">` +
      `<div ${attr}="${val}">Correct answer: PIZZA</div>` +
      `</div>`;
    const out = captureQuestions([block], undefined, (t) => leaks.push(t));
    expect(out).toBe("");
    expect(leaks).toEqual([val]);
  });

  it("санкционированный [data-analysis] НЕ триггерит (штатный стрип, панель непуста)", () => {
    const leaks: string[] = [];
    const block =
      `<div class="question" id="question-1">` +
      `<input type="text" name="q1">` +
      `<div class="analysis" data-analysis="1">The answer is A</div>` +
      `</div>`;
    const out = captureQuestions([block], undefined, (t) => leaks.push(t));
    expect(out).not.toBe("");
    expect(leaks).toEqual([]);
    expect(out).not.toMatch(/analysis/i);
  });

  it("легитимные class/id (cstat answered / map-answers / answer-input) НЕ триггерят", () => {
    const leaks: string[] = [];
    const block =
      `<div class="question" id="question-1">` +
      `<div class="cstat answered">x</div><div class="map-answers">g</div>` +
      `<span class="answer-input">y</span>` +
      `<div id="map-answers"></div><div id="answered"></div><div id="answer-input"></div>` +
      `<input type="text" name="q1">` +
      `</div>`;
    const out = captureQuestions([block], undefined, (t) => leaks.push(t));
    expect(out).not.toBe("");
    expect(leaks).toEqual([]);
    const $ = load(out, null, false);
    expect($('.q-slot[data-q="1"]').length).toBe(1);
  });
});
