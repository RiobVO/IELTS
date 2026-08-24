// Юнит-тесты канонизации типов вопросов (BRIEF §4.2).
import { describe, it, expect } from "vitest";
import {
  canonQuestionType,
  blankTypeWarning,
  isUnresolvedQuestionTypeWarning,
  isChooseManyLabel,
} from "./question-types";

describe("canonQuestionType", () => {
  // Реальные ярлыки из источников → канон-энум. Ожидаемые значения выписаны руками,
  // чтобы тест не дублировал внутреннюю таблицу маппинга.
  const KNOWN: [string, string][] = [
    ["True / False / Not Given", "tfng"],
    ["Yes / No / Not Given", "ynng"],
    ["Multiple Choice", "mcq_single"],
    ["MCQ", "mcq_single"], // голая аббревиатура из источников
    ["Multiple Choice (single)", "mcq_single"],
    ["Multiple Choice (multiple)", "mcq_multi"],
    ["Matching Headings", "matching_headings"],
    ["Matching Information", "matching_info"],
    ["Matching Features", "matching_features"],
    ["Matching Sentence Endings", "matching_sentence_endings"],
    ["Sentence Endings", "matching_sentence_endings"], // голая форма без «Matching»
    ["Sentence Completion", "sentence_completion"],
    ["Summary Completion", "summary_completion"],
    ["Note Completion", "note_completion"],
    ["Notes Completion", "note_completion"],
    ["Classification", "matching_features"], // спец-ремап классификации
    ["Matching Researcher", "matching_features"], // сопоставление людей с утверждениями — features, не info
    ["Matching People", "matching_features"], // Inspera-канон клиента: люди↔утверждения — features, не info
    ["Matching Paragraph", "matching_info"], // Inspera-канон: «какой абзац содержит…» = matching_info
    ["Matching Paragraphs", "matching_info"],
    ["Flowchart Completion", "flowchart_completion"],
    ["Table Completion", "table_completion"],
    ["Diagram Label Completion", "diagram_label"],
    ["Diagram Labelling", "diagram_label"],
    ["Plan / Map / Diagram Labelling", "map_labelling"],
    ["Map Labelling", "map_labelling"],
    ["Map/Plan labelling", "map_labelling"],
    ["Plan/Map labelling", "map_labelling"],
    ["Form Completion", "form_completion"],
    ["Short Answer", "short_answer"],
    ["Short Answer Questions", "short_answer"],
  ];

  it.each(KNOWN)("ярлык «%s» → канон с confident=true", (label, expected) => {
    expect(canonQuestionType(label)).toEqual({ type: expected, confident: true });
  });

  it("нормализует пунктуацию/пробелы/регистр перед сопоставлением", () => {
    // разные написания одного типа дают один канон
    expect(canonQuestionType("TRUE/FALSE/NOT GIVEN").type).toBe("tfng");
    expect(canonQuestionType("true false not given").type).toBe("tfng");
  });

  it("неизвестный/пустой ярлык → type:null, confident:false", () => {
    expect(canonQuestionType("Cloze Test")).toEqual({ type: null, confident: false });
    expect(canonQuestionType("")).toEqual({ type: null, confident: false });
    expect(canonQuestionType("   ")).toEqual({ type: null, confident: false });
    expect(canonQuestionType("123 !!!")).toEqual({ type: null, confident: false });
  });

  it("декорации (секц-префикс / скобочный квалификатор) срезаются → confident, а истинно нечёткое остаётся low-confidence", () => {
    // Ведущий «Section N —» и хвостовой «(…)» срезаются перед EXACT-retry — тот же
    // уверенный тип, а не шум на ревью-экране (прямая цель фикса: убрать ложный low-confidence).
    expect(canonQuestionType("Note Completion")).toEqual({ type: "note_completion", confident: true });
    expect(canonQuestionType("Section 2 — Note Completion")).toEqual({
      type: "note_completion",
      confident: true,
    });
    expect(canonQuestionType("Note Completion (ONE WORD ONLY)")).toEqual({
      type: "note_completion",
      confident: true,
    });
    // Голое «matching» осознанно неоднозначно (решение владельца отложено) → остаётся
    // low-confidence через CONTAINS-фолбэк, декорации тут ни при чём.
    expect(canonQuestionType("Some Matching")).toEqual({ type: "matching_info", confident: false });
  });

  it("EXACT приоритетнее CONTAINS: точная метка уверенна, обёртка без EXACT — substring", () => {
    // «Note Completion» попадает в EXACT → confident:true; «Some Matching» промахивается
    // мимо EXACT (и после strip тоже) и ловится только substring-фолбэком «matching» →
    // confident:false. Доказывает порядок EXACT перед CONTAINS.
    expect(canonQuestionType("Note Completion").confident).toBe(true);
    expect(canonQuestionType("Some Matching")).toEqual({
      type: "matching_info",
      confident: false,
    });
  });
});

// QTYPE hard-block (2026-07-11, BACKLOG W2-3b): и пустой, и непустой нераспознанный qtype
// блокируют publish — authoring-спека (docs/authoring-spec.md) требует QTYPE на каждый
// вопрос. Раньше (P1, 2026-07-09) пустой label был смягчён до informational, пока спеки
// не было; isUnresolvedQuestionTypeWarning реверсирует это смягчение и остаётся
// blank-aware в другую сторону — ловит и УЖЕ сохранённые старым форматом драфты.
describe("blankTypeWarning / isUnresolvedQuestionTypeWarning (QTYPE hard-block)", () => {
  it("blankTypeWarning считается блокирующим unresolved-type", () => {
    expect(isUnresolvedQuestionTypeWarning(blankTypeWarning(3))).toBe(true);
  });

  it("persisted пустой-label warning (старый маркер unknownTypeWarning) тоже блокирует", () => {
    expect(isUnresolvedQuestionTypeWarning('Q1: unknown type "" → fell back to short_answer')).toBe(
      true,
    );
  });

  // Дословный формат blankTypeWarning ДО hard-block (P1-смягчение): такие строки остались
  // в import_warnings старых драфтов — гейт обязан ловить их literal-форму (Codex 2026-07-11).
  it("historical persisted blank-format (informational-текст P1) блокирует", () => {
    expect(
      isUnresolvedQuestionTypeWarning(
        "Q3: no question type provided in source — informational, grading unaffected",
      ),
    ).toBe(true);
  });

  // JSON.stringify НЕ экранирует U+2028/U+2029; без dotAll `.` их не матчит — дыра в гейте.
  it("label с U+2028 line separator не проскакивает мимо гейта", () => {
    expect(
      isUnresolvedQuestionTypeWarning(
        `Q4: unknown type "line sep" → fell back to short_answer`,
      ),
    ).toBe(true);
  });

  it("непустой нераспознанный тип остаётся блокирующим", () => {
    expect(
      isUnresolvedQuestionTypeWarning('Q2: unknown type "Frobnicate" → fell back to short_answer'),
    ).toBe(true);
  });

  // Codex-ревью (2026-07-09): маркер, лежащий ВНУТРИ JSON-label чужого low-confidence
  // warning, не должен давать ложный блок (bare includes(marker) его ловил).
  it("маркер внутри label чужого low-confidence warning не блокирует", () => {
    expect(
      isUnresolvedQuestionTypeWarning(
        'Q3: low-confidence type "Matching → fell back to" → matching_info',
      ),
    ).toBe(false);
  });

  it("envelope с непарсибельным JSON-label — fail-closed (блок)", () => {
    expect(isUnresolvedQuestionTypeWarning('Q9: unknown type "\\p" → fell back to short_answer')).toBe(
      true,
    );
  });

  it("строка не в форме сгенерированного envelope не блокирует", () => {
    // генератор ВСЕГДА кавычит label (JSON.stringify) — строка без кавычек не наш warning
    expect(isUnresolvedQuestionTypeWarning("Q9: unknown type → fell back to short_answer")).toBe(
      false,
    );
  });

  it("посторонний текст не матчится по BLANK_ENVELOPE префиксу", () => {
    expect(isUnresolvedQuestionTypeWarning("Q1: no question type here, false positive check")).toBe(
      false,
    );
  });
});

// Вариант B: детект label choose-TWO/THREE по СОСТАВНОМУ префиксу (multiplechoice + two/
// three), а не голому "two"/"three" — иначе "Note completion (two words)" ложно попадёт в
// multi-select. qtype-выход canonQuestionType при этом не меняется (label остаётся mcq_single).
describe("isChooseManyLabel", () => {
  it("реальные choose-TWO/THREE ярлыки → true", () => {
    expect(isChooseManyLabel("Multiple Choice (TWO answers)")).toBe(true);
    expect(isChooseManyLabel("Multiple Choice (Two Answers)")).toBe(true);
    expect(isChooseManyLabel("Multiple Choice (three answers)")).toBe(true);
  });

  it("plain / completion ярлыки → false (защита от голого two/three)", () => {
    expect(isChooseManyLabel("Multiple Choice")).toBe(false);
    expect(isChooseManyLabel("Note completion (two words)")).toBe(false);
    expect(isChooseManyLabel("Sentence completion (TWO WORDS)")).toBe(false);
    expect(isChooseManyLabel("")).toBe(false);
  });
});
