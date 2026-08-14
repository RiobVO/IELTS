// Юнит-тесты чистой cron-логики: UTC-даты и dedup_key. Относительный импорт.
import { describe, it, expect } from "vitest";
import {
  utcDateStr,
  prevUtcDateStr,
  vocabDueDedupKey,
  streakDedupKey,
} from "./schedule";

describe("utcDateStr", () => {
  it("берёт UTC-день, игнорируя время", () => {
    expect(utcDateStr(new Date("2026-07-08T06:00:00.000Z"))).toBe("2026-07-08");
    expect(utcDateStr(new Date("2026-07-08T23:59:59.999Z"))).toBe("2026-07-08");
  });
});

describe("prevUtcDateStr", () => {
  it("вычитает один день", () => {
    expect(prevUtcDateStr("2026-07-08")).toBe("2026-07-07");
  });
  it("корректно переходит через границу месяца", () => {
    expect(prevUtcDateStr("2026-07-01")).toBe("2026-06-30");
  });
  it("корректно переходит через границу года", () => {
    expect(prevUtcDateStr("2026-01-01")).toBe("2025-12-31");
  });
});

describe("dedup keys", () => {
  it("vocab_due:<день>", () => {
    expect(vocabDueDedupKey("2026-07-08")).toBe("vocab_due:2026-07-08");
  });
  it("streak:<день>", () => {
    expect(streakDedupKey("2026-07-08")).toBe("streak:2026-07-08");
  });
  it("ключи разных продюсеров не пересекаются в один день", () => {
    const day = "2026-07-08";
    expect(vocabDueDedupKey(day)).not.toBe(streakDedupKey(day));
  });
});
