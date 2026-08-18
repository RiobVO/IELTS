import { describe, it, expect, vi, beforeEach } from "vitest";

// persistTest пишет всё в одной транзакции — мокаем db.transaction, чтобы прогнать
// её без реальной БД. Цепочки select/insert/delete повторяют РЕАЛЬНЫЙ порядок
// вызовов в persist.ts (тот же стиль моков, что publish.test.ts).
const { select, insert, del } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  del: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: { transaction: (cb: (tx: unknown) => unknown) => cb({ select, insert, delete: del }) },
}));

import { allAttemptsAdminOnly, persistTest, RegradeRequiredError } from "./persist";
import type { ParsedTest } from "./types";

// select #1: existing content_item по sourceFilePath — .from().where() (без .limit()).
const existingChain = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
// select #2 (только когда existing.length>0): attempt LEFT JOIN profile.role —
// .from().leftJoin().where(). LEFT (не INNER): dangling attempt без строки profile
// обязан остаться в выборке с role=null (fail-safe отказ), а не выпасть из неё.
const attemptRoleChain = (rows: unknown[]) => ({
  from: () => ({ leftJoin: () => ({ where: () => Promise.resolve(rows) }) }),
});
const insertReturning = (rows: unknown[]) => ({ values: () => ({ returning: () => Promise.resolve(rows) }) });
const insertPlain = () => ({ values: () => Promise.resolve(undefined) });

// Минимальный валидный ParsedTest: 1 пассаж + 1 вопрос — ровно один insert-проход
// на каждую из четырёх таблиц (content_item/passage/question/answer_key).
const minimalParsed: ParsedTest = {
  title: "T",
  section: "reading",
  category: "passage_1",
  bandType: "reading",
  durationSeconds: null,
  questionTypes: ["short_answer"],
  bandScale: null,
  warnings: [],
  passages: [{ order: 1, title: null, bodyHtml: "<p>p</p>", audioPath: null }],
  questions: [
    {
      number: 1,
      passageOrder: 1,
      qtype: "short_answer",
      promptHtml: "<p>q</p>",
      options: null,
      groupKey: null,
      evidenceRef: null,
      answer: { mode: "text_accept", accept: ["a"], explanation: null, evidence: null },
    },
  ],
};

beforeEach(() => {
  select.mockReset();
  insert.mockReset();
  del.mockReset();
  del.mockReturnValue({ where: () => Promise.resolve(undefined) });
});

describe("allAttemptsAdminOnly", () => {
  it("пустой список — некого блокировать", () => {
    expect(allAttemptsAdminOnly([])).toBe(true);
  });

  it("все попытки — admin", () => {
    expect(allAttemptsAdminOnly([{ role: "admin" }, { role: "admin" }])).toBe(true);
  });

  it("хоть одна студенческая попытка — не all-admin", () => {
    expect(allAttemptsAdminOnly([{ role: "admin" }, { role: "student" }])).toBe(false);
  });

  it("единственная попытка — студенческая", () => {
    expect(allAttemptsAdminOnly([{ role: "student" }])).toBe(false);
  });

  // Fail-safe (Codex-ревью F4): role=null (dangling attempt без profile из LEFT
  // JOIN, или NULL-роль) — НЕ admin: провенанс неоднозначен, re-import отклоняется.
  it("role=null — не admin (fail-safe)", () => {
    expect(allAttemptsAdminOnly([{ role: null }])).toBe(false);
    expect(allAttemptsAdminOnly([{ role: "admin" }, { role: null }])).toBe(false);
  });
});

describe("persistTest — admin-only-attempts re-import (F4 «Sit as student»)", () => {
  it("все существующие попытки — admin: переимпорт проходит, каскад чистит их сам", async () => {
    select
      .mockReturnValueOnce(existingChain([{ id: "old-id" }]))
      .mockReturnValueOnce(attemptRoleChain([{ role: "admin" }, { role: "admin" }]));
    insert
      .mockReturnValueOnce(insertReturning([{ id: "new-id" }])) // content_item
      .mockReturnValueOnce(insertReturning([{ id: "passage-1" }])) // passage
      .mockReturnValueOnce(insertReturning([{ id: "question-1" }])) // question
      .mockReturnValueOnce(insertPlain()); // answer_key

    const id = await persistTest(minimalParsed, { sourceFilePath: "f.html" });

    expect(id).toBe("new-id");
    // Явного DELETE FROM attempt нет — обычный delete(content_item) (уже в коде)
    // каскадит на attempt/attempt_review_snapshot/mistake_* сам.
    expect(del).toHaveBeenCalledOnce();
  });

  it("смешанные попытки (есть студенческая) — отказывает как раньше, ничего не пишет", async () => {
    select
      .mockReturnValueOnce(existingChain([{ id: "old-id" }]))
      .mockReturnValueOnce(attemptRoleChain([{ role: "admin" }, { role: "student" }]));

    await expect(
      persistTest(minimalParsed, { sourceFilePath: "f.html" }),
    ).rejects.toBeInstanceOf(RegradeRequiredError);
    expect(insert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("только студенческие попытки — отказывает (регресс-защита исходного поведения)", async () => {
    select
      .mockReturnValueOnce(existingChain([{ id: "old-id" }]))
      .mockReturnValueOnce(attemptRoleChain([{ role: "student" }]));

    await expect(
      persistTest(minimalParsed, { sourceFilePath: "f.html" }),
    ).rejects.toThrow(/1 attempt/);
    expect(insert).not.toHaveBeenCalled();
  });

  // Codex-ревью F4: dangling attempt (нет строки profile → LEFT JOIN даёт role=null)
  // НЕ должен позволять деструктивный re-import — фолсил бы «admin-only» при INNER JOIN.
  it("dangling attempt (role=null из LEFT JOIN) — отказывает, ничего не пишет", async () => {
    select
      .mockReturnValueOnce(existingChain([{ id: "old-id" }]))
      .mockReturnValueOnce(attemptRoleChain([{ role: "admin" }, { role: null }]));

    await expect(
      persistTest(minimalParsed, { sourceFilePath: "f.html" }),
    ).rejects.toBeInstanceOf(RegradeRequiredError);
    expect(insert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("нет существующего content_item (первый импорт по этому файлу) — attempt-запрос вообще не идёт", async () => {
    select.mockReturnValueOnce(existingChain([]));
    insert
      .mockReturnValueOnce(insertReturning([{ id: "new-id" }]))
      .mockReturnValueOnce(insertReturning([{ id: "passage-1" }]))
      .mockReturnValueOnce(insertReturning([{ id: "question-1" }]))
      .mockReturnValueOnce(insertPlain());

    const id = await persistTest(minimalParsed, { sourceFilePath: "f2.html" });

    expect(id).toBe("new-id");
    expect(select).toHaveBeenCalledTimes(1); // только existing-запрос, без attempt-джойна
  });
});
