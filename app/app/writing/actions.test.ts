import { describe, it, expect, vi, beforeEach } from "vitest";
// Hoisted so the vi.mock factories (hoisted above) can reference these eagerly.
const { getUser, getProfile, counts, recentCount, insert, trigger, readOwn, markFailed, failStale, featureEnabled, loadTask } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getProfile: vi.fn(),
  counts: vi.fn(),
  recentCount: vi.fn(),
  insert: vi.fn(),
  trigger: vi.fn(),
  readOwn: vi.fn(),
  markFailed: vi.fn(),
  failStale: vi.fn(),
  featureEnabled: vi.fn(),
  loadTask: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getUser, getProfile }));
vi.mock("@/lib/writing/store", () => ({ completedCounts: counts, countRecentSubmissions: recentCount, insertPendingSubmission: insert, triggerEvaluate: trigger, readOwnSubmission: readOwn, markFailed, failStaleSubmissions: failStale, loadWritingTaskForSubmissionGate: loadTask }));
vi.mock("@/env", () => ({ writingFeatureEnabled: featureEnabled }));
import { createWritingSubmission, getSubmissionStatus } from "./actions";
import { WRITING_STALE_MS, WRITING_RATE_MAX } from "@/lib/writing/lifecycle";

const TASK = "11111111-1111-1111-1111-111111111111"; // a well-formed task id

beforeEach(() => {
  [getUser, getProfile, counts, recentCount, insert, trigger, readOwn, markFailed, failStale, featureEnabled, loadTask].forEach((m) => m.mockReset());
  featureEnabled.mockReturnValue(true); // default: fully configured; #5 cases override
  failStale.mockResolvedValue(0); // default: nothing stale to reap
  recentCount.mockResolvedValue(0); // default: under the rate cap; #21 case overrides
  loadTask.mockResolvedValue({ status: "published", tierRequired: "basic" }); // default: open task; #2 cases override
});

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
    expect(await createWritingSubmission({ taskId: TASK, essay: Array(30).fill("w").join(" ") })).toEqual({ ok: false, reason: "in_progress" });
  });
  it("inserts + triggers for an allowed user", async () => {
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "ultra", premium_until: null }); counts.mockResolvedValue({ lifetime: 5, today: 0 }); insert.mockResolvedValue("sub1");
    expect(await createWritingSubmission({ taskId: TASK, essay: Array(30).fill("w").join(" ") })).toEqual({ ok: true, submissionId: "sub1" });
    expect(trigger).toHaveBeenCalledWith("sub1");
  });

  it("throttles a submission burst over the rate cap without insert (#21)", async () => {
    // A failed eval doesn't spend the preview/cap, so cap the submission RATE to bound the
    // paid Gemini retry loop. At/over the window cap → reject before any insert or trigger.
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "ultra", premium_until: null }); counts.mockResolvedValue({ lifetime: 0, today: 0 });
    recentCount.mockResolvedValue(WRITING_RATE_MAX); // window already at the cap
    expect(await createWritingSubmission({ taskId: TASK, essay: Array(30).fill("w").join(" ") })).toEqual({ ok: false, reason: "too_fast" });
    expect(insert).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it("reaps the user's own stale row BEFORE insert (#1)", async () => {
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "ultra", premium_until: null }); counts.mockResolvedValue({ lifetime: 0, today: 0 }); insert.mockResolvedValue("sub1");
    await createWritingSubmission({ taskId: TASK, essay: Array(30).fill("w").join(" ") });
    expect(failStale).toHaveBeenCalledWith(expect.any(Date), "u1"); // user-scoped
    expect(failStale.mock.invocationCallOrder[0]).toBeLessThan(insert.mock.invocationCallOrder[0]);
  });

  it("blocks when the feature is not fully configured (origin/secret missing) without insert", async () => {
    featureEnabled.mockReturnValue(false); // model+key present but no origin/secret → trigger would no-op
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "ultra", premium_until: null }); counts.mockResolvedValue({ lifetime: 0, today: 0 }); insert.mockResolvedValue("sub1");
    expect(await createWritingSubmission({ taskId: "t1", essay: Array(30).fill("w").join(" ") })).toEqual({ ok: false, reason: "not_configured" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a draft task without insert (#2)", async () => {
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "ultra", premium_until: null }); counts.mockResolvedValue({ lifetime: 0, today: 0 }); insert.mockResolvedValue("sub1");
    loadTask.mockResolvedValue({ status: "draft", tierRequired: "basic" });
    expect(await createWritingSubmission({ taskId: TASK, essay: Array(30).fill("w").join(" ") })).toEqual({ ok: false, reason: "unavailable" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an ultra-only task for a premium user without insert (#2)", async () => {
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "premium", premium_until: null }); counts.mockResolvedValue({ lifetime: 0, today: 0 }); insert.mockResolvedValue("sub1");
    loadTask.mockResolvedValue({ status: "published", tierRequired: "ultra" });
    expect(await createWritingSubmission({ taskId: TASK, essay: Array(30).fill("w").join(" ") })).toEqual({ ok: false, reason: "unavailable" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a malformed taskId before any task read (#2)", async () => {
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "ultra", premium_until: null }); counts.mockResolvedValue({ lifetime: 0, today: 0 }); insert.mockResolvedValue("sub1");
    expect(await createWritingSubmission({ taskId: "not-a-uuid", essay: Array(30).fill("w").join(" ") })).toEqual({ ok: false, reason: "unavailable" });
    expect(loadTask).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("allows a premium task for a premium user (#2)", async () => {
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "premium", premium_until: null }); counts.mockResolvedValue({ lifetime: 0, today: 0 }); insert.mockResolvedValue("sub1");
    loadTask.mockResolvedValue({ status: "published", tierRequired: "premium" });
    expect(await createWritingSubmission({ taskId: TASK, essay: Array(30).fill("w").join(" ") })).toEqual({ ok: true, submissionId: "sub1" });
    expect(trigger).toHaveBeenCalledWith("sub1");
  });

  // #D: Writing min tier is Premium; Basic gets one lifetime teaser (canEvaluate gates it
  // above). The per-task tier_required must NOT block that preview — only at-tier (premium+)
  // users are checked against it. (Premium→ultra task still rejected above: #2 holds.)
  it("allows a basic preview on a premium task (#D — preview revived)", async () => {
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "basic", premium_until: null }); counts.mockResolvedValue({ lifetime: 0, today: 0 }); insert.mockResolvedValue("sub1");
    loadTask.mockResolvedValue({ status: "published", tierRequired: "premium" });
    expect(await createWritingSubmission({ taskId: TASK, essay: Array(30).fill("w").join(" ") })).toEqual({ ok: true, submissionId: "sub1" });
    expect(insert).toHaveBeenCalled();
  });
});

describe("getSubmissionStatus", () => {
  beforeEach(() => getUser.mockResolvedValue({ id: "u1" }));

  it("re-kicks a fresh pending, does not reap it", async () => {
    readOwn.mockResolvedValue({ status: "pending", updatedAt: new Date() });
    expect(await getSubmissionStatus("s1")).toEqual({ status: "pending" });
    expect(trigger).toHaveBeenCalledWith("s1");
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("reaps a stuck pending to failed without re-kicking (lost trigger)", async () => {
    readOwn.mockResolvedValue({ status: "pending", updatedAt: new Date(Date.now() - WRITING_STALE_MS - 1000) });
    expect(await getSubmissionStatus("s1")).toEqual({ status: "failed" });
    expect(markFailed).toHaveBeenCalledWith("s1");
    expect(trigger).not.toHaveBeenCalled();
  });

  it("reaps a stuck evaluating to failed", async () => {
    readOwn.mockResolvedValue({ status: "evaluating", updatedAt: new Date(Date.now() - WRITING_STALE_MS - 1000) });
    expect(await getSubmissionStatus("s1")).toEqual({ status: "failed" });
    expect(markFailed).toHaveBeenCalledWith("s1");
  });

  it("leaves a fresh evaluating running", async () => {
    readOwn.mockResolvedValue({ status: "evaluating", updatedAt: new Date() });
    expect(await getSubmissionStatus("s1")).toEqual({ status: "evaluating" });
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("passes through a completed submission", async () => {
    readOwn.mockResolvedValue({ status: "completed", updatedAt: new Date(0) });
    expect(await getSubmissionStatus("s1")).toEqual({ status: "completed" });
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("returns null when the row is not the user's", async () => {
    readOwn.mockResolvedValue(null);
    expect(await getSubmissionStatus("s1")).toBeNull();
  });
});
