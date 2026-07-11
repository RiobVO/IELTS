import { describe, it, expect } from "vitest";
import { audioObjectKey } from "./audio-key";

describe("audioObjectKey", () => {
  it("детерминирован: одни и те же байты дают один и тот же ключ", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(audioObjectKey("cid-1", bytes)).toBe(audioObjectKey("cid-1", bytes));
  });

  it("разные байты дают разные ключи при том же contentItemId", () => {
    const a = new Uint8Array([1, 2, 3]).buffer;
    const b = new Uint8Array([9, 9, 9]).buffer;
    expect(audioObjectKey("cid-1", a)).not.toBe(audioObjectKey("cid-1", b));
  });

  it("формат имени — id, дефис, 8 hex, .mp3", () => {
    const bytes = new Uint8Array([5, 6, 7]).buffer;
    expect(audioObjectKey("abc-123", bytes)).toMatch(/^abc-123-[0-9a-f]{8}\.mp3$/);
  });
});
