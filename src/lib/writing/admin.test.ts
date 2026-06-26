import { describe, it, expect, vi, beforeEach } from "vitest";

// deleteWritingTask gates a hard-delete on "no submissions". We mock @/db so the
// test exercises that guard, not a real DB. admin.ts pulls only @/db/schema and
// @/lib/tiers besides @/db — both pure, no @/env to stub (unlike store.test.ts).
const select = vi.fn();
const del = vi.fn();
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => select(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));
import { deleteWritingTask } from "./admin";

const selectChain = (rows: unknown[]) => ({
  from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
});
const deleteChain = () => ({ where: () => Promise.resolve(undefined) });

beforeEach(() => {
  select.mockReset();
  del.mockReset();
});

describe("deleteWritingTask", () => {
  it("hard-deletes a topic with no submissions", async () => {
    select.mockReturnValue(selectChain([]));
    del.mockReturnValue(deleteChain());
    const res = await deleteWritingTask("t1");
    expect(res).toEqual({ deleted: true, hasSubmissions: false });
    expect(del).toHaveBeenCalledOnce();
  });

  it("refuses to delete a topic that has submissions and signals it", async () => {
    select.mockReturnValue(selectChain([{ id: "s1" }]));
    const res = await deleteWritingTask("t1");
    expect(res).toEqual({ deleted: false, hasSubmissions: true });
    expect(del).not.toHaveBeenCalled();
  });
});
