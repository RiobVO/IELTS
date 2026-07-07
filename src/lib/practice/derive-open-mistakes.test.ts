// Юнит-тесты чистой деривации открытых ошибок (P9-rich «вариант B»). Контракт:
// последняя попытка по каждому (тест, вопрос) решает вердикт; неверные (по gradeOne,
// как submit) → ошибки; резолюции вычитаются; порядок — свежие сверху; наружу уходят
// только безопасные поля (без accept/mode).
import { describe, it, expect } from "vitest";
import {
  deriveOpenMistakes,
  type AttemptForMistakes,
} from "./derive-open-mistakes";

/** Хелпер: попытка с одним снапшот-вопросом (exact-ключ). */
function attempt(
  over: Partial<AttemptForMistakes> & {
    contentItemId: string;
    number: number;
    accept: string[];
    given: string | string[] | null;
    submittedAt: Date;
    qtype?: string;
  },
): AttemptForMistakes {
  return {
    attemptId: over.attemptId ?? `${over.contentItemId}-${over.submittedAt.getTime()}`,
    contentItemId: over.contentItemId,
    title: over.title ?? "Test",
    section: over.section ?? "reading",
    hasRunner: over.hasRunner ?? true,
    submittedAt: over.submittedAt,
    answers: { [String(over.number)]: over.given },
    questions: [{ number: over.number, qtype: over.qtype ?? "tfng", mode: "exact", accept: over.accept }],
  };
}

/** Хелпер: резолюция; по умолчанию свежее любой попытки в тестах (гасит). */
function resolution(contentItemId: string, questionNumber: number, resolvedAt = new Date("2026-12-31")) {
  return { contentItemId, questionNumber, resolvedAt };
}

describe("deriveOpenMistakes", () => {
  it("неверный ответ (по gradeOne) → открытая ошибка; наружу только безопасные поля", () => {
    const out = deriveOpenMistakes(
      [attempt({ contentItemId: "c1", number: 3, qtype: "tfng", accept: ["TRUE"], given: "FALSE", submittedAt: new Date("2026-07-01") })],
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      contentItemId: "c1",
      title: "Test",
      section: "reading",
      hasRunner: true,
      questionNumber: 3,
      qtype: "tfng",
      attemptId: out[0].attemptId,
      submittedAt: new Date("2026-07-01"),
    });
    // accept/mode не утекают в результат.
    expect(out[0]).not.toHaveProperty("accept");
    expect(out[0]).not.toHaveProperty("mode");
  });

  it("верный ответ не попадает в ошибки; неотвеченный (null) считается неверным (как grade())", () => {
    const out = deriveOpenMistakes(
      [
        attempt({ contentItemId: "c1", number: 1, accept: ["TRUE"], given: "TRUE", submittedAt: new Date("2026-07-01") }),
        attempt({ contentItemId: "c1", number: 2, accept: ["FALSE"], given: null, submittedAt: new Date("2026-07-01") }),
      ],
      [],
    );
    expect(out.map((m) => m.questionNumber)).toEqual([2]);
  });

  it("дедуп по (тест, вопрос): свежая попытка решает — исправленное в свежей не ошибка", () => {
    const oldWrong = attempt({ contentItemId: "c1", number: 5, accept: ["A"], given: "B", submittedAt: new Date("2026-07-01") });
    const newRight = attempt({ contentItemId: "c1", number: 5, accept: ["A"], given: "A", submittedAt: new Date("2026-07-05") });
    // порядок входа обратный — деривация сама сортирует по свежести.
    expect(deriveOpenMistakes([oldWrong, newRight], [])).toHaveLength(0);
  });

  it("дедуп по (тест, вопрос): в свежей всё ещё неверно — ровно одна ошибка от свежей попытки", () => {
    const oldWrong = attempt({ contentItemId: "c1", number: 5, accept: ["A"], given: "B", submittedAt: new Date("2026-07-01"), attemptId: "old" });
    const newWrong = attempt({ contentItemId: "c1", number: 5, accept: ["A"], given: "C", submittedAt: new Date("2026-07-05"), attemptId: "new" });
    const out = deriveOpenMistakes([oldWrong, newWrong], []);
    expect(out).toHaveLength(1);
    expect(out[0].attemptId).toBe("new"); // свежая попытка — источник
  });

  it("резолюция (сделанная после попытки) вычитает ошибку из открытого списка", () => {
    const attempts = [attempt({ contentItemId: "c1", number: 7, accept: ["A"], given: "B", submittedAt: new Date("2026-07-01") })];
    expect(deriveOpenMistakes(attempts, [])).toHaveLength(1);
    expect(deriveOpenMistakes(attempts, [resolution("c1", 7)])).toHaveLength(0);
  });

  it("резолюция скоупится по (тест, вопрос) — не гасит одноимённый вопрос в другом тесте", () => {
    const attempts = [
      attempt({ contentItemId: "c1", number: 7, accept: ["A"], given: "B", submittedAt: new Date("2026-07-01") }),
      attempt({ contentItemId: "c2", number: 7, accept: ["A"], given: "B", submittedAt: new Date("2026-07-01") }),
    ];
    const out = deriveOpenMistakes(attempts, [resolution("c1", 7)]);
    expect(out.map((m) => m.contentItemId)).toEqual(["c2"]);
  });

  it("re-fail после «Mark learned» переоткрывает ошибку: резолюция старее попытки не гасит", () => {
    // Ошибка (07-01) → mark learned (07-02) → снова ошибся в новой попытке (07-05).
    const oldWrong = attempt({ contentItemId: "c1", number: 7, accept: ["A"], given: "B", submittedAt: new Date("2026-07-01"), attemptId: "old" });
    const newWrong = attempt({ contentItemId: "c1", number: 7, accept: ["A"], given: "C", submittedAt: new Date("2026-07-05"), attemptId: "new" });
    const out = deriveOpenMistakes([oldWrong, newWrong], [resolution("c1", 7, new Date("2026-07-02"))]);
    expect(out).toHaveLength(1);
    expect(out[0].attemptId).toBe("new");
  });

  it("forged-резолюция впрок (раньше любой попытки) инертна — будущая ошибка открыта", () => {
    const attempts = [attempt({ contentItemId: "c1", number: 7, accept: ["A"], given: "B", submittedAt: new Date("2026-07-05") })];
    expect(deriveOpenMistakes(attempts, [resolution("c1", 7, new Date("2026-07-01"))])).toHaveLength(1);
  });

  it("порядок: свежие попытки сверху", () => {
    const out = deriveOpenMistakes(
      [
        attempt({ contentItemId: "old", number: 1, accept: ["A"], given: "B", submittedAt: new Date("2026-07-01") }),
        attempt({ contentItemId: "new", number: 1, accept: ["A"], given: "B", submittedAt: new Date("2026-07-06") }),
      ],
      [],
    );
    expect(out.map((m) => m.contentItemId)).toEqual(["new", "old"]);
  });
});
