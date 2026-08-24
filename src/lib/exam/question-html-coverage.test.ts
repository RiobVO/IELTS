import { describe, expect, it } from "vitest";
import { extractSlotQuestionNumbers, questionsHtmlCoversAll } from "./question-html-coverage";

describe("extractSlotQuestionNumbers", () => {
  it("собирает номера всех .q-slot[data-q] тегов", () => {
    const html = `<span class="q-slot" data-q="1" data-qtype="text"></span><span class="q-slot" data-q="2" data-qtype="radio" data-value="A"></span>`;
    expect(extractSlotQuestionNumbers(html)).toEqual([1, 2]);
  });

  it("пустой HTML → пустой список", () => {
    expect(extractSlotQuestionNumbers("")).toEqual([]);
  });
});

describe("questionsHtmlCoversAll", () => {
  it("полное покрытие — все номера вопросов размечены слотами", () => {
    const html = `<span class="q-slot" data-q="1"></span><p>text</p><span class="q-slot" data-q="2"></span>`;
    expect(questionsHtmlCoversAll(html, [1, 2])).toBe(true);
  });

  it("частичное покрытие — слот отсутствует для одного номера", () => {
    const html = `<span class="q-slot" data-q="1"></span>`;
    expect(questionsHtmlCoversAll(html, [1, 2])).toBe(false);
  });

  it("пустой HTML → false", () => {
    expect(questionsHtmlCoversAll("", [1, 2])).toBe(false);
  });

  it("пустой список номеров — нечего покрывать, гейт не блокирует", () => {
    expect(questionsHtmlCoversAll("", [])).toBe(true);
  });
});
