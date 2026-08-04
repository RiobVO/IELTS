import { describe, it, expect, vi, beforeEach } from "vitest";

// Integration test for the Telegram publish path — the vulnerable one (#1): handlePublish
// flipped status to 'published' with no reviewed_at gate. We mock @/env (telegramConfig +
// the env const that @/lib/supabase/service reads at import), @/db, the Telegram client
// and next/cache so importing the route doesn't validate real env or hit the network.
const { dbSelect, dbUpdate, answerCallback, sendMessage } = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  answerCallback: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock("@/env", () => ({
  telegramConfig: () => ({ token: "t", adminIds: [42], webhookSecret: null }),
  env: {},
}));
vi.mock("@/db", () => ({
  db: { select: (...a: unknown[]) => dbSelect(...a), update: (...a: unknown[]) => dbUpdate(...a) },
}));
vi.mock("@/lib/telegram/client", () => ({
  answerCallback,
  sendMessage,
  sendUploadResult: vi.fn(),
  downloadFileText: vi.fn(),
  downloadFileBytes: vi.fn(),
  getFilePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
import { POST } from "./route";

const ID = "11111111-1111-1111-1111-111111111111";
const selectChain = (rows: unknown[]) => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) });
const updateChain = () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) });
const publishCallback = () =>
  new Request("http://x/api/telegram/webhook", {
    method: "POST",
    body: JSON.stringify({
      callback_query: { id: "c1", from: { id: 42 }, data: `publish:${ID}`, message: { chat: { id: 7 } } },
    }),
  });

beforeEach(() => [dbSelect, dbUpdate, answerCallback, sendMessage].forEach((m) => m.mockReset()));

describe("telegram publish gate (#1)", () => {
  it("does NOT publish an unreviewed content item", async () => {
    dbSelect.mockReturnValue(selectChain([{ reviewedAt: null, title: "T" }]));
    await POST(publishCallback());
    expect(dbUpdate).not.toHaveBeenCalled(); // no status flip without review
  });

  it("publishes a reviewed content item", async () => {
    dbSelect.mockReturnValue(selectChain([{ reviewedAt: new Date(), title: "T" }]));
    dbUpdate.mockReturnValue(updateChain());
    await POST(publishCallback());
    expect(dbUpdate).toHaveBeenCalledOnce();
  });
});
