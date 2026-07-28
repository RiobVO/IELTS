// Юнит-тесты онбординг-мини-диагностики (W1-2b). Грейд клиентский, чистая функция
// — проверяем perType/weakType и нормализацию ответа. Полностью inline.
import { describe, it, expect } from "vitest";
import {
  gradeDiagnostic,
  DIAGNOSTIC_QUESTIONS,
} from "./diagnostic";

// Карта правильных ответов из канона диагностики — строим из самого набора,
// чтобы тест не дублировал зашитые значения и не протух при правке текста.
const CORRECT: Record<number, string> = Object.fromEntries(
  DIAGNOSTIC_QUESTIONS.map((q) => [q.number, q.answer]),
);

describe("gradeDiagnostic", () => {
  it("все верно → correct=total, weakType=null, perType покрывает все типы", () => {
    const r = gradeDiagnostic(CORRECT);
    expect(r.correct).toBe(DIAGNOSTIC_QUESTIONS.length);
    expect(r.total).toBe(DIAGNOSTIC_QUESTIONS.length);
    expect(r.weakType).toBeNull();
    // perType суммируется по всем заданным типам, total в сумме = числу вопросов.
    const summedTotal = Object.values(r.perType).reduce((s, t) => s + t.total, 0);
    expect(summedTotal).toBe(DIAGNOSTIC_QUESTIONS.length);
    for (const s of Object.values(r.perType)) {
      expect(s.correct).toBe(s.total);
    }
  });

  it("один тип проседает → он становится weakType", () => {
    // Все верно, кроме обоих sentence_completion (q3, q4) — их доля верных = 0,
    // ниже любого другого типа → weakType строго sentence_completion.
    const answers = { ...CORRECT, 3: "WRONG", 4: "WRONG" };
    const r = gradeDiagnostic(answers);
    expect(r.weakType).toBe("sentence_completion");
    expect(r.perType.sentence_completion).toEqual({ correct: 0, total: 2 });
  });

  it("нормализует ответ: trim + регистронезависимо", () => {
    // Ответы с другим регистром и обрамляющими пробелами засчитываются как верные.
    const messy = Object.fromEntries(
      DIAGNOSTIC_QUESTIONS.map((q) => [q.number, `  ${q.answer.toLowerCase()}  `]),
    );
    const r = gradeDiagnostic(messy);
    expect(r.correct).toBe(DIAGNOSTIC_QUESTIONS.length);
    expect(r.weakType).toBeNull();
  });

  it("пустой/отсутствующий ответ не засчитывается как верный", () => {
    // Пустая строка после нормализации не равна непустому ключу → неверно.
    const r = gradeDiagnostic({});
    expect(r.correct).toBe(0);
    expect(r.total).toBe(DIAGNOSTIC_QUESTIONS.length);
  });
});
