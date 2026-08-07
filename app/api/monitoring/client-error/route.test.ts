import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/db (rate-limit count), auth (owner lookup) and the sink so the endpoint logic runs
// isolated — env is never validated and no network/DB is hit.
const { dbSelect, logError, getUser } = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  logError: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => dbSelect(...a) } }));
vi.mock("@/lib/auth", () => ({ getUser }));
vi.mock("@/lib/monitoring/log-error", () => ({ logError }));
import { POST } from "./route";

// db.select().from().where() → [{ n }]
const countChain = (n: number) => ({ from: () => ({ where: () => Promise.resolve([{ n }]) }) });
const req = (body: string) =>
  new Request("http://x/api/monitoring/client-error", { method: "POST", body });

beforeEach(() => {
  [dbSelect, logError, getUser].forEach((m) => m.mockReset());
  getUser.mockResolvedValue(null);
  logError.mockResolvedValue(undefined);
  dbSelect.mockReturnValue(countChain(0)); // under the rate cap by default
});

describe("client-error endpoint", () => {
  it("logs a valid client error (200)", async () => {
    const res = await POST(req(JSON.stringify({ message: "boom", url: "http://x/app?ref=abc" })));
    expect(res.status).toBe(200);
    expect(logError).toHaveBeenCalledOnce();
    expect(logError.mock.calls[0]![0]).toMatchObject({ source: "client", message: "boom" });
  });

  it("rejects invalid JSON (400) without logging", async () => {
    const res = await POST(req("not json"));
    expect(res.status).toBe(400);
    expect(logError).not.toHaveBeenCalled();
  });

  it("rejects a missing message (400)", async () => {
    const res = await POST(req(JSON.stringify({ url: "x" })));
    expect(res.status).toBe(400);
    expect(logError).not.toHaveBeenCalled();
  });

  it("rejects an oversized body (413) without logging", async () => {
    const res = await POST(req(JSON.stringify({ message: "x".repeat(20000) })));
    expect(res.status).toBe(413);
    expect(logError).not.toHaveBeenCalled();
  });

  it("drops silently over the rate cap (204) — anti-flood backstop", async () => {
    dbSelect.mockReturnValue(countChain(120)); // at the window cap
    const res = await POST(req(JSON.stringify({ message: "boom" })));
    expect(res.status).toBe(204);
    expect(logError).not.toHaveBeenCalled();
  });
});
