import { describe, it, expect, vi, beforeEach } from "vitest";

// #1: writing cron-reaper — fails stuck pending|evaluating rows so the one-active index
// unblocks for users who left the page. Auth via cronSecret() (fail-closed).
const { cronSecretFn, failStale, logErrorFn } = vi.hoisted(() => ({ cronSecretFn: vi.fn(), failStale: vi.fn(), logErrorFn: vi.fn() }));
vi.mock("@/env", () => ({ cronSecret: cronSecretFn }));
vi.mock("@/lib/writing/store", () => ({ failStaleSubmissions: failStale }));
// route теперь оборачивает GET в try/catch с logError (F10) — мокаем, как соседние route-тесты.
vi.mock("@/lib/monitoring/log-error", () => ({ logError: logErrorFn }));

import { GET } from "./route";

const req = (auth: string) => new Request("http://x/api/cron/writing-reaper", { headers: { authorization: auth } });

beforeEach(() => {
  cronSecretFn.mockReset().mockReturnValue("s");
  failStale.mockReset().mockResolvedValue(3);
  logErrorFn.mockReset().mockResolvedValue(undefined);
});

describe("writing-reaper GET (#1)", () => {
  it("401 при неверной авторизации, без reap", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(failStale).not.toHaveBeenCalled();
  });

  it("401 при отсутствии секрета (fail-closed)", async () => {
    cronSecretFn.mockReturnValue(null);
    const res = await GET(req("Bearer s"));
    expect(res.status).toBe(401);
    expect(failStale).not.toHaveBeenCalled();
  });

  it("фейлит stale-строки при валидной авторизации", async () => {
    const res = await GET(req("Bearer s"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, failed: 3 });
    expect(failStale).toHaveBeenCalledWith(expect.any(Date)); // global (no userId)
    expect(failStale.mock.calls[0]).toHaveLength(1);
  });

  it("500 + logError, когда failStaleSubmissions падает (F10)", async () => {
    failStale.mockRejectedValue(new Error("db down"));
    const res = await GET(req("Bearer s"));
    expect(res.status).toBe(500);
    expect(logErrorFn).toHaveBeenCalledOnce();
  });
});
