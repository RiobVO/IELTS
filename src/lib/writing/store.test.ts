import { describe, it, expect, vi, beforeEach } from "vitest";
const update = vi.fn();
vi.mock("@/db", () => ({ db: { update: (...a: unknown[]) => update(...a) } }));
// store.ts импортирует @/env (writingInternalSecret/publicSiteUrl) на верхнем уровне,
// а env.ts валидирует серверные секреты при загрузке (throws без них). Мокаем, чтобы
// тест падал на проверяемой логике, а не на импорте. Эти тесты не зовут triggerEvaluate.
vi.mock("@/env", () => ({ writingInternalSecret: () => null, publicSiteUrl: () => null }));
import { claimForEvaluation } from "./store";

const chain = (rows: unknown[]) => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(rows) }) }) });
beforeEach(() => update.mockReset());

describe("claimForEvaluation", () => {
  it("true when pending→evaluating updates a row", async () => {
    update.mockReturnValue(chain([{ id: "s1" }]));
    expect(await claimForEvaluation("s1")).toBe(true);
  });
  it("false when already claimed/finished (0 rows)", async () => {
    update.mockReturnValue(chain([]));
    expect(await claimForEvaluation("s1")).toBe(false);
  });
});
