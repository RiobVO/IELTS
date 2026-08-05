import { describe, it, expect, vi, beforeEach } from "vitest";

// #6: reaper на retention-пути должен помечать audio_deleted_at ТОЛЬКО после успешного
// remove. Раньше сбой remove логировался, но строка помечалась deleted → орфан-биометрия
// past-retention навсегда (следующий проход пропускает audio_deleted_at IS NOT NULL).
// Мокаем @/env (cronSecret), @/db (query-builder-цепочки), storage и store.
const { dbUpdate, dbSelect, deleteAudioFn, markDeleted, markDeleteFailed } = vi.hoisted(() => ({
  dbUpdate: vi.fn(),
  dbSelect: vi.fn(),
  deleteAudioFn: vi.fn(),
  markDeleted: vi.fn(),
  markDeleteFailed: vi.fn(),
}));

vi.mock("@/env", () => ({ cronSecret: () => "s" }));
vi.mock("@/db", () => ({
  db: { update: (...a: unknown[]) => dbUpdate(...a), select: (...a: unknown[]) => dbSelect(...a) },
}));
vi.mock("@/lib/speaking/storage", () => ({ deleteAudio: deleteAudioFn }));
vi.mock("@/lib/speaking/store", () => ({ markAudioDeleted: markDeleted, markAudioDeleteFailed: markDeleteFailed }));

import { GET } from "./route";

const authed = () => new Request("http://x/api/cron/speaking-reaper", { headers: { authorization: "Bearer s" } });
const ROW = { id: "s1", audioPath: "u1/s1.webm", userId: "u1" };

beforeEach(() => {
  [dbUpdate, dbSelect, deleteAudioFn, markDeleted, markDeleteFailed].forEach((m) => m.mockReset());
  // (1) stuck update: .set().where().returning() → no stuck rows.
  dbUpdate.mockReturnValue({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) });
  // (2) toClean select: .from().where() → one retention-old row.
  dbSelect.mockReturnValue({ from: () => ({ where: () => Promise.resolve([ROW]) }) });
});

describe("speaking-reaper GET (#6)", () => {
  it("401 при неверной авторизации", async () => {
    const res = await GET(new Request("http://x", { headers: { authorization: "Bearer wrong" } }));
    expect(res.status).toBe(401);
  });

  it("НЕ помечает deleted при сбое remove — строка остаётся retryable", async () => {
    deleteAudioFn.mockRejectedValue(new Error("storage down"));
    const res = await GET(authed());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(markDeleted).not.toHaveBeenCalled();
    expect(markDeleteFailed).toHaveBeenCalledWith("s1", expect.stringContaining("storage down"));
    expect(body.cleaned).toBe(0);
  });

  it("помечает deleted после успешного remove", async () => {
    deleteAudioFn.mockResolvedValue(undefined);
    const res = await GET(authed());
    const body = await res.json();
    expect(markDeleted).toHaveBeenCalledWith("s1", "u1", "retention");
    expect(markDeleteFailed).not.toHaveBeenCalled();
    expect(body.cleaned).toBe(1);
  });
});
