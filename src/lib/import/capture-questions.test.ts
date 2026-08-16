import { describe, it, expect } from "vitest";
import { captureQuestions } from "./capture-questions";

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
