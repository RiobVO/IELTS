import { describe, it, expect, vi, beforeEach } from "vitest";
// vi.mock factories are hoisted above these declarations, and they reference the
// mock fns eagerly (not behind a thunk), so the fns must be hoisted too — a plain
// `const` would ReferenceError ("Cannot access 'claim' before initialization").
const { claim, persist, fail, evaluate, load, logError } = vi.hoisted(() => ({
  claim: vi.fn(),
  persist: vi.fn(),
  fail: vi.fn(),
  evaluate: vi.fn(),
  load: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("@/lib/writing/store", () => ({ claimForEvaluation: claim, persistFeedback: persist, markFailed: fail, loadSubmissionForEval: load }));
vi.mock("@/lib/writing/evaluator", () => ({ getEvaluator: () => ({ evaluate }) }));
vi.mock("@/env", () => ({ writingInternalSecret: () => "s3cret" }));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: (h: string | null, s: string | null) => h === `Bearer ${s}` }));
// route теперь логирует провал через logError (@/db-backed) — мокаем, как соседние route-тесты.
vi.mock("@/lib/monitoring/log-error", () => ({ logError }));
import { POST } from "./route";
const req = (auth: string | null, body: object) => new Request("http://x", { method: "POST", headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });
beforeEach(() => {
  [claim, persist, fail, evaluate, load, logError].forEach((m) => m.mockReset());
  logError.mockResolvedValue(undefined);
});

describe("POST /api/writing/evaluate", () => {
  it("401 without secret, no claim", async () => {
    expect((await POST(req(null, { submissionId: "s1" }))).status).toBe(401);
    expect(claim).not.toHaveBeenCalled();
  });
  it("200 no-op on lost claim", async () => {
    claim.mockResolvedValue(false);
    await POST(req("Bearer s3cret", { submissionId: "s1" }));
    expect(evaluate).not.toHaveBeenCalled();
  });
  it("evaluates + persists on won claim", async () => {
    claim.mockResolvedValue(true); load.mockResolvedValue({ essay: "e", taskPrompt: "t", category: "academic", wordCount: 300 });
    evaluate.mockResolvedValue({ feedback: {}, raw: "{}", provider: "gemini", model: "m", promptVersion: "v1" });
    await POST(req("Bearer s3cret", { submissionId: "s1" }));
    expect(persist).toHaveBeenCalledWith("s1", expect.any(Object));
  });
  it("injects the underlength fix before persisting a short essay", async () => {
    claim.mockResolvedValue(true); load.mockResolvedValue({ essay: "e", taskPrompt: "t", category: "academic", wordCount: 120 });
    evaluate.mockResolvedValue({
      feedback: { topFixes: ["broaden vocabulary"], checklist: [], criteria: [], annotations: [] },
      raw: "{}", provider: "gemini", model: "m", promptVersion: "v1",
    });
    await POST(req("Bearer s3cret", { submissionId: "s1" }));
    const persisted = persist.mock.calls[0][1];
    expect(persisted.feedback.topFixes[0]).toMatch(/120 words/);
  });
  it("marks failed when evaluate throws", async () => {
    claim.mockResolvedValue(true); load.mockResolvedValue({ essay: "e", taskPrompt: "t", category: "academic", wordCount: 300 });
    evaluate.mockRejectedValue(new Error("boom"));
    await POST(req("Bearer s3cret", { submissionId: "s1" }));
    expect(fail).toHaveBeenCalledWith("s1"); expect(persist).not.toHaveBeenCalled();
  });
});
