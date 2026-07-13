import { describe, it, expect, vi, beforeEach } from "vitest";
// vi.mock factories are hoisted above these declarations, and they reference the
// mock fns eagerly (not behind a thunk), so the fns must be hoisted too — a plain
// `const` would ReferenceError ("Cannot access 'claim' before initialization").
const { claim, load, markStatus, persist, generate, logError } = vi.hoisted(() => ({
  claim: vi.fn(),
  load: vi.fn(),
  markStatus: vi.fn(),
  persist: vi.fn(),
  generate: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("@/env", () => ({ cronSecret: () => "s3cret", l1GenConfig: () => ({ apiKey: "k", model: "m" }) }));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: (h: string | null, s: string | null) => h === `Bearer ${s}` }));
vi.mock("@/lib/content/l1/generate", () => ({ generateL1ForPassage: generate }));
vi.mock("@/lib/content/l1/store", () => ({
  claimL1: claim,
  loadTestForL1: load,
  markL1Status: markStatus,
  persistL1: persist,
}));
// route логирует провал через logError (@/db-backed) — мокаем, как соседний route-тест (writing/evaluate).
vi.mock("@/lib/monitoring/log-error", () => ({ logError }));
import { POST } from "./route";

const req = (auth: string | null, body: object) =>
  new Request("http://x", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
    body: JSON.stringify(body),
  });

const passage = {
  passageId: "p1",
  bodyHtml: "<p>text</p>",
  questions: [
    {
      questionId: "q1",
      number: 1,
      qtype: "short-answer",
      promptHtml: "<p>Q1</p>",
      options: null,
      accept: ["answer"],
      explanationEn: null,
      evidenceSnippet: null,
    },
  ],
};

beforeEach(() => {
  [claim, load, markStatus, persist, generate, logError].forEach((m) => m.mockReset());
  logError.mockResolvedValue(undefined);
  markStatus.mockResolvedValue(undefined);
});

describe("POST /api/content/generate-l1", () => {
  it("per-passage reject logs the error and still marks failed", async () => {
    claim.mockResolvedValue(true);
    load.mockResolvedValue([passage]);
    generate.mockRejectedValue(new Error("gemini model not found"));
    persist.mockResolvedValue(0);

    const res = await POST(req("Bearer s3cret", { contentItemId: "c1" }));

    expect(res.status).toBe(200);
    expect(logError).toHaveBeenCalledTimes(1);
    const call = logError.mock.calls[0][0];
    expect(call.source).toBe("server");
    expect(call.message).toMatch(/gemini model not found/);
    expect(call.context).toMatchObject({ op: "l1Generate", contentItemId: "c1", passageId: "p1" });
    expect(markStatus).toHaveBeenCalledWith("c1", "failed");
  });

  it("logs the general failure with contentItemId when loadTestForL1 rejects", async () => {
    claim.mockResolvedValue(true);
    load.mockRejectedValue(new Error("db unreachable"));

    const res = await POST(req("Bearer s3cret", { contentItemId: "c2" }));

    expect(res.status).toBe(500);
    expect(logError).toHaveBeenCalledTimes(1);
    const call = logError.mock.calls[0][0];
    expect(call.source).toBe("server");
    expect(call.message).toMatch(/db unreachable/);
    expect(call.context).toMatchObject({ op: "l1Generate", contentItemId: "c2" });
    expect(markStatus).toHaveBeenCalledWith("c2", "failed");
  });

  it("logs the secondary markL1Status failure separately and still returns 500", async () => {
    claim.mockResolvedValue(true);
    load.mockRejectedValue(new Error("db unreachable"));
    markStatus.mockRejectedValue(new Error("mark write refused"));

    const res = await POST(req("Bearer s3cret", { contentItemId: "c4" }));

    // Вторичный сбой не меняет контракт route (по-прежнему 500), но оставляет
    // СВОЙ след с op l1MarkFailed — тест, залипший в generating, виден в error_log.
    expect(res.status).toBe(500);
    expect(logError).toHaveBeenCalledTimes(2);
    const primary = logError.mock.calls[0][0];
    expect(primary.source).toBe("server");
    expect(primary.message).toMatch(/db unreachable/);
    expect(primary.context).toMatchObject({ op: "l1Generate", contentItemId: "c4" });
    const secondary = logError.mock.calls[1][0];
    expect(secondary.source).toBe("server");
    expect(secondary.message).toMatch(/mark write refused/);
    expect(secondary.context).toMatchObject({ op: "l1MarkFailed", contentItemId: "c4" });
  });

  it("does not log on a full success", async () => {
    claim.mockResolvedValue(true);
    load.mockResolvedValue([passage]);
    generate.mockResolvedValue([{ number: 1, explanation: "потому что..." }]);
    persist.mockResolvedValue(1);

    const res = await POST(req("Bearer s3cret", { contentItemId: "c3" }));

    expect(res.status).toBe(200);
    expect(logError).not.toHaveBeenCalled();
    expect(markStatus).toHaveBeenCalledWith("c3", "done");
  });
});
