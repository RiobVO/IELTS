// Юнит-тесты чистой cap-логики. access.ts импортирует @/db (owner-клиент, тянет @/env
// с валидацией секретов при загрузке → throws без них). Мокаем @/db, чтобы тест грузил
// чистые функции, а не поднимал БД/env (паттерн store.test.ts).
import { describe, it, expect, vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));
import { decideNewCardCap, newCardsRemaining } from "./access";
import { VOCAB_DAILY_NEW_LIMIT } from "@/lib/tiers";

describe("newCardsRemaining", () => {
  it("premium/ultra — безлимит (null)", () => {
    expect(newCardsRemaining("premium", 100)).toBeNull();
    expect(newCardsRemaining("ultra", 0)).toBeNull();
  });

  it("basic — остаток = LIMIT − сегодня, не ниже 0", () => {
    expect(newCardsRemaining("basic", 0)).toBe(VOCAB_DAILY_NEW_LIMIT);
    expect(newCardsRemaining("basic", VOCAB_DAILY_NEW_LIMIT)).toBe(0);
    expect(newCardsRemaining("basic", VOCAB_DAILY_NEW_LIMIT + 5)).toBe(0);
  });
});

describe("decideNewCardCap — границы дневного лимита (basic, LIMIT=20)", () => {
  it("19-я новая карта (18 начато) — разрешена, остаток 2", () => {
    const d = decideNewCardCap({ tier: "basic", isNewCard: true, newTodayCount: 18 });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.newRemainingToday).toBe(2);
  });

  it("20-я новая карта (19 начато) — разрешена, остаток 1", () => {
    const d = decideNewCardCap({ tier: "basic", isNewCard: true, newTodayCount: 19 });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.newRemainingToday).toBe(1);
  });

  it("21-я новая карта (20 начато) — отказ daily_cap", () => {
    const d = decideNewCardCap({ tier: "basic", isNewCard: true, newTodayCount: 20 });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("daily_cap");
  });

  it("повтор (не новая карта) не ест лимит даже за пределом", () => {
    const d = decideNewCardCap({ tier: "basic", isNewCard: false, newTodayCount: 100 });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.newRemainingToday).toBe(0);
  });

  it("premium — новая карта без лимита (остаток null)", () => {
    const d = decideNewCardCap({ tier: "premium", isNewCard: true, newTodayCount: 999 });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.newRemainingToday).toBeNull();
  });
});
