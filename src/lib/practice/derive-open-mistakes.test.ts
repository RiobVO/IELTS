// Юнит-тесты чистой деривации открытых ошибок (P9-rich «вариант B»). Контракт:
// последняя попытка по каждому (тест, вопрос) решает вердикт; неверные (по gradeOne,
// как submit) → ошибки; резолюции вычитаются; порядок — свежие сверху; наружу уходят
// только безопасные поля (без accept/mode).
import { describe, it, expect } from "vitest";
import {
  deriveOpenMistakes,
  type AttemptForMistakes,
  type MistakeReviewRow,
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
      // Без SR-строки — ошибка due сейчас (расписания ещё нет).
      dueAt: null,
      isDue: true,
      intervalDays: 0,
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

/** SR-строка mistake_review (SM-2-расписание одной ошибки). */
function review(
  contentItemId: string,
  questionNumber: number,
  over: { dueAt: Date; intervalDays: number; lastReviewedAt: Date | null },
): MistakeReviewRow {
  return { contentItemId, questionNumber, ...over };
}

describe("deriveOpenMistakes — SR-расписание", () => {
  // Фиксированное «сейчас» ради детерминизма (as в reviewCard).
  const now = new Date("2026-07-10T00:00:00Z");

  it("нет SR-строки → due сейчас (dueAt null, isDue true, intervalDays 0)", () => {
    const out = deriveOpenMistakes(
      [attempt({ contentItemId: "c1", number: 1, accept: ["A"], given: "B", submittedAt: new Date("2026-07-01") })],
      [],
      [],
      now,
    );
    expect(out).toHaveLength(1);
    expect(out[0].isDue).toBe(true);
    expect(out[0].dueAt).toBeNull();
    expect(out[0].intervalDays).toBe(0);
  });

  it("due_at в будущем + попытка НЕ новее last_reviewed_at → scheduled (isDue false)", () => {
    const att = attempt({ contentItemId: "c1", number: 1, accept: ["A"], given: "B", submittedAt: new Date("2026-07-01") });
    const out = deriveOpenMistakes([att], [], [
      review("c1", 1, { dueAt: new Date("2026-07-13"), intervalDays: 3, lastReviewedAt: new Date("2026-07-05") }),
    ], now);
    expect(out).toHaveLength(1);
    expect(out[0].isDue).toBe(false);
    expect(out[0].intervalDays).toBe(3);
    expect(out[0].dueAt).toEqual(new Date("2026-07-13"));
  });

  it("due_at <= now → due (isDue true)", () => {
    const att = attempt({ contentItemId: "c1", number: 1, accept: ["A"], given: "B", submittedAt: new Date("2026-07-01") });
    const out = deriveOpenMistakes([att], [], [
      review("c1", 1, { dueAt: new Date("2026-07-08"), intervalDays: 1, lastReviewedAt: new Date("2026-07-07") }),
    ], now);
    expect(out[0].isDue).toBe(true);
  });

  it("re-open: wrong-попытка ПОЗЖЕ last_reviewed_at → расписание протухло (isDue true при due_at в будущем)", () => {
    // Ревью 07-05 (запланировано на 07-20), затем снова ошибся 07-08 → расписание невалидно.
    const att = attempt({ contentItemId: "c1", number: 1, accept: ["A"], given: "B", submittedAt: new Date("2026-07-08") });
    const out = deriveOpenMistakes([att], [], [
      review("c1", 1, { dueAt: new Date("2026-07-20"), intervalDays: 7, lastReviewedAt: new Date("2026-07-05") }),
    ], now);
    expect(out[0].isDue).toBe(true);
  });

  it("резолюция гасит и при наличии SR-строки (как раньше)", () => {
    const att = attempt({ contentItemId: "c1", number: 1, accept: ["A"], given: "B", submittedAt: new Date("2026-07-01") });
    const out = deriveOpenMistakes([att], [resolution("c1", 1)], [
      review("c1", 1, { dueAt: new Date("2026-07-20"), intervalDays: 7, lastReviewedAt: new Date("2026-07-05") }),
    ], now);
    expect(out).toHaveLength(0);
  });

  it("сортировка: due-первые, scheduled — потом (даже если scheduled-попытка свежее)", () => {
    // cA без SR-строки → due; cB запланирован в будущее, попытка не новее ревью → scheduled.
    const dueMistake = attempt({ contentItemId: "cA", number: 1, accept: ["A"], given: "B", submittedAt: new Date("2026-07-01") });
    const schedMistake = attempt({ contentItemId: "cB", number: 1, accept: ["A"], given: "B", submittedAt: new Date("2026-07-09T00:00:00Z") });
    const out = deriveOpenMistakes([dueMistake, schedMistake], [], [
      review("cB", 1, { dueAt: new Date("2026-07-20"), intervalDays: 7, lastReviewedAt: new Date("2026-07-09T12:00:00Z") }),
    ], now);
    // Без due-first свежая cB (07-09) шла бы первой; сортировка опускает scheduled вниз.
    expect(out.map((m) => m.contentItemId)).toEqual(["cA", "cB"]);
    expect(out[0].isDue).toBe(true);
    expect(out[1].isDue).toBe(false);
  });
});
