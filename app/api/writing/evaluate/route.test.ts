import { describe, it, expect, vi, beforeEach } from "vitest";
// vi.mock factories are hoisted above these declarations, and they reference the
// mock fns eagerly (not behind a thunk), so the fns must be hoisted too — a plain
// `const` would ReferenceError ("Cannot access 'claim' before initialization").
const { claim, persist, fail, evaluate, load } = vi.hoisted(() => ({
  claim: vi.fn(),
  persist: vi.fn(),
  fail: vi.fn(),
  evaluate: vi.fn(),
  load: vi.fn(),
}));
vi.mock("@/lib/writing/store", () => ({ claimForEvaluation: claim, persistFeedback: persist, markFailed: fail, loadSubmissionForEval: load }));
vi.mock("@/lib/writing/evaluator", () => ({ getEvaluator: () => ({ evaluate }) }));
vi.mock("@/env", () => ({ writingInternalSecret: () => "s3cret" }));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: (h: string | null, s: string | null) => h === `Bearer ${s}` }));
import { POST } from "./route";
const req = (auth: string | null, body: object) => new Request("http://x", { method: "POST", headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });
beforeEach(() => [claim, persist, fail, evaluate, load].forEach((m) => m.mockReset()));

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
    claim.mockResolvedValue(true); load.mockResolvedValue({ essay: "e", taskPrompt: "t", category: "academic" });
    evaluate.mockResolvedValue({ feedback: {}, raw: "{}", provider: "gemini", model: "m", promptVersion: "v1" });
    await POST(req("Bearer s3cret", { submissionId: "s1" }));
    expect(persist).toHaveBeenCalledWith("s1", expect.any(Object));
  });
  it("marks failed when evaluate throws", async () => {
    claim.mockResolvedValue(true); load.mockResolvedValue({ essay: "e", taskPrompt: "t", category: "academic" });
    evaluate.mockRejectedValue(new Error("boom"));
    await POST(req("Bearer s3cret", { submissionId: "s1" }));
    expect(fail).toHaveBeenCalledWith("s1"); expect(persist).not.toHaveBeenCalled();
  });
});
