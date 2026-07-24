// Юнит-тесты канонизации типов вопросов (BRIEF §4.2).
import { describe, it, expect } from "vitest";
import { canonQuestionType } from "./question-types";

describe("canonQuestionType", () => {
  // Реальные ярлыки из источников → канон-энум. Ожидаемые значения выписаны руками,
  // чтобы тест не дублировал внутреннюю таблицу маппинга.
  const KNOWN: [string, string][] = [
    ["True / False / Not Given", "tfng"],
    ["Yes / No / Not Given", "ynng"],
    ["Multiple Choice", "mcq_single"],
    ["Multiple Choice (single)", "mcq_single"],
    ["Multiple Choice (multiple)", "mcq_multi"],
    ["Matching Headings", "matching_headings"],
    ["Matching Information", "matching_info"],
    ["Matching Features", "matching_features"],
    ["Matching Sentence Endings", "matching_sentence_endings"],
    ["Sentence Completion", "sentence_completion"],
    ["Summary Completion", "summary_completion"],
    ["Note Completion", "note_completion"],
    ["Notes Completion", "note_completion"],
    ["Classification", "matching_features"], // спец-ремап классификации
    ["Flowchart Completion", "flowchart_completion"],
    ["Table Completion", "table_completion"],
    ["Diagram Label Completion", "diagram_label"],
    ["Diagram Labelling", "diagram_label"],
    ["Plan / Map / Diagram Labelling", "map_labelling"],
    ["Map Labelling", "map_labelling"],
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

  it("нечёткое совпадение по подстроке возвращается, но с confident=false (флаг на ревью)", () => {
    // точный ярлык — уверенно; тот же тип в окружении слов — нечётко
    expect(canonQuestionType("Note Completion")).toEqual({
      type: "note_completion",
      confident: true,
    });
    expect(canonQuestionType("Section 2 — Note Completion")).toEqual({
      type: "note_completion",
      confident: false,
    });
  });
});
