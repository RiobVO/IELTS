import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// triggerL1Generation — fire-and-forget: fetch-сбой обязан оставить след в logError
// (эфемерных Vercel-логов недостаточно), а не уронить вызывающего. Мокаем @/db
// (модульный импорт тянет postgres-подключение), @/env и global fetch — как в
// соседних тестах (telegram/client.test.ts, email/send.test.ts).
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/env", () => ({
  l1FeatureEnabled: () => true,
  publicSiteUrl: () => "https://site.test",
  cronSecret: () => "s3cret",
}));
vi.mock("@/lib/monitoring/log-error", () => ({ logError }));
import { triggerL1Generation } from "./store";

const savedFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = savedFetch;
});
beforeEach(() => {
  logError.mockReset();
  logError.mockResolvedValue(undefined);
});

describe("triggerL1Generation", () => {
  it("logs the fetch failure with the error text and contentItemId, without throwing", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED site.test"));

    await expect(triggerL1Generation("c1")).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    const call = logError.mock.calls[0][0];
    expect(call.source).toBe("server");
    expect(call.message).toMatch(/ECONNREFUSED site\.test/);
    expect(call.context).toMatchObject({ op: "l1Trigger", contentItemId: "c1" });
  });

  it("does not log when the trigger fetch succeeds", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true } as Response);
    globalThis.fetch = f;

    await triggerL1Generation("c2");

    expect(logError).not.toHaveBeenCalled();
    // Триггер бьёт в internal route с cron-секретом — закрепляем адрес и auth.
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://site.test/api/content/generate-l1");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer s3cret");
    expect(JSON.parse(init.body as string)).toEqual({ contentItemId: "c2" });
  });
});
