import { describe, it, expect, vi, beforeEach } from "vitest";
// Hoisted so the vi.mock factories (hoisted above) can reference these eagerly.
const { getUser, getProfile, counts, insert, trigger } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getProfile: vi.fn(),
  counts: vi.fn(),
  insert: vi.fn(),
  trigger: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getUser, getProfile }));
vi.mock("@/lib/writing/store", () => ({ completedCounts: counts, insertPendingSubmission: insert, triggerEvaluate: trigger, readOwnSubmission: vi.fn(), markFailed: vi.fn() }));
vi.mock("@/env", () => ({ writingEvalConfig: () => ({ apiKey: "k", model: "m" }) }));
import { createWritingSubmission } from "./actions";
beforeEach(() => [getUser, getProfile, counts, insert, trigger].forEach((m) => m.mockReset()));

describe("createWritingSubmission", () => {
  it("blocks over-preview non-Ultra without insert", async () => {
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "basic", premium_until: null }); counts.mockResolvedValue({ lifetime: 1, today: 0 });
    expect(await createWritingSubmission({ taskId: "t1", essay: Array(30).fill("w").join(" ") })).toEqual({ ok: false, reason: "preview_used" });
    expect(insert).not.toHaveBeenCalled();
  });
  it("blocks too-long essay before any DB work", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    expect(await createWritingSubmission({ taskId: "t1", essay: Array(2000).fill("w").join(" ") })).toEqual({ ok: false, reason: "too_long" });
    expect(getProfile).not.toHaveBeenCalled();
  });
  it("surfaces in_progress when the active-index conflict yields null", async () => {
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "ultra", premium_until: null }); counts.mockResolvedValue({ lifetime: 0, today: 0 }); insert.mockResolvedValue(null);
    expect(await createWritingSubmission({ taskId: "t1", essay: Array(30).fill("w").join(" ") })).toEqual({ ok: false, reason: "in_progress" });
  });
  it("inserts + triggers for an allowed user", async () => {
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "ultra", premium_until: null }); counts.mockResolvedValue({ lifetime: 5, today: 0 }); insert.mockResolvedValue("sub1");
    expect(await createWritingSubmission({ taskId: "t1", essay: Array(30).fill("w").join(" ") })).toEqual({ ok: true, submissionId: "sub1" });
    expect(trigger).toHaveBeenCalledWith("sub1");
  });
});
