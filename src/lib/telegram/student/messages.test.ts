// Тексты бота (G2-1). Проверяем обещания, а не формулировки: не раскрыть ответ до
// ответа, не выдумать стрик, не оставить человека без пути на сайт.
import { describe, it, expect } from "vitest";
import {
  helpMessage,
  linkedMessage,
  nothingDueMessage,
  questionMessage,
  streakMessage,
  verdictMessage,
} from "./messages";

describe("questionMessage", () => {
  it("несёт контекст (тест и номер) и сам вопрос", () => {
    const text = questionMessage({
      prompt: "The scheme reduced street temperature.",
      testTitle: "Cambridge 21 Test 1",
      questionNumber: 14,
      hasOptions: true,
    });
    expect(text).toContain("Cambridge 21 Test 1");
    expect(text).toContain("Q14");
    expect(text).toContain("The scheme reduced street temperature.");
  });

  it("для свободного ввода просит ответить текстом, для кнопок — нет", () => {
    const free = questionMessage({ prompt: "p", testTitle: "t", questionNumber: 1, hasOptions: false });
    const withOptions = questionMessage({ prompt: "p", testTitle: "t", questionNumber: 1, hasOptions: true });
    expect(free).toMatch(/reply/i);
    expect(withOptions).not.toMatch(/reply/i);
  });
});

describe("verdictMessage", () => {
  it("верный ответ — короткое подтверждение без ключа", () => {
    const text = verdictMessage({ correct: true, expected: "TRUE", reviewUrl: null });
    expect(text).toMatch(/correct/i);
    expect(text).not.toContain("TRUE");
  });

  it("неверный — называет правильный ответ (это его же разобранная ошибка)", () => {
    const text = verdictMessage({ correct: false, expected: "NOT GIVEN", reviewUrl: null });
    expect(text).toContain("NOT GIVEN");
  });

  it("без ключа в базе не притворяется, что знает ответ", () => {
    const text = verdictMessage({ correct: false, expected: null, reviewUrl: null });
    expect(text).toMatch(/not quite/i);
    expect(text).not.toMatch(/answer is/i);
  });

  it("ведёт на разбор, когда ссылка есть", () => {
    const text = verdictMessage({
      correct: false,
      expected: "A",
      reviewUrl: "https://bando.study/app/practice/mistakes?src=tg_bot",
    });
    expect(text).toContain("https://bando.study/app/practice/mistakes?src=tg_bot");
  });
});

describe("остальные тексты", () => {
  it("приветствие объясняет, что будет и как отписаться", () => {
    const text = linkedMessage();
    expect(text).toMatch(/\/stop/);
    expect(text).toMatch(/wrong before/i);
  });

  it("пустая очередь не ругает, а зовёт практиковаться", () => {
    const text = nothingDueMessage("https://bando.study/app/practice");
    expect(text).toMatch(/caught up/i);
    expect(text).toContain("https://bando.study/app/practice");
    // Без origin ссылки нет и обрубка "…: " тоже.
    expect(nothingDueMessage(null)).not.toContain("http");
  });

  it("стрик-пинг называет число дней", () => {
    expect(streakMessage(6, null)).toContain("6-day");
  });

  it("справка перечисляет обе команды", () => {
    const text = helpMessage();
    expect(text).toMatch(/\/question/);
    expect(text).toMatch(/\/stop/);
  });
});
