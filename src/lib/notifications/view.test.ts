// Юнит-тесты защитного разбора jsonb-payload уведомлений. Относительный импорт.
import { describe, it, expect } from "vitest";
import { parseNotifPayload, notifHref } from "./view";

describe("parseNotifPayload", () => {
  it("badge_unlocked → ссылка на /app/badges (иконку-эмодзи из data игнорируем)", () => {
    expect(parseNotifPayload("badge_unlocked", { code: "streak_7", icon: "🔥" })).toEqual({
      kind: "badge_unlocked",
      href: "/app/badges",
    });
  });

  it("system + kind=vocab_due_reminder → href и dueCount из data", () => {
    expect(
      parseNotifPayload("system", {
        kind: "vocab_due_reminder",
        href: "/app/vocabulary",
        dueCount: 12,
      }),
    ).toEqual({ kind: "vocab_due_reminder", href: "/app/vocabulary", dueCount: 12 });
  });

  it("vocab-напоминание без href → дефолтный /app/vocabulary", () => {
    expect(parseNotifPayload("system", { kind: "vocab_due_reminder" })).toEqual({
      kind: "vocab_due_reminder",
      href: "/app/vocabulary",
      dueCount: 0,
    });
  });

  it("vocab-напоминание с нечисловым/отрицательным dueCount → 0", () => {
    expect(parseNotifPayload("system", { kind: "vocab_due_reminder", dueCount: "5" }).kind).toBe(
      "vocab_due_reminder",
    );
    expect(
      (parseNotifPayload("system", { kind: "vocab_due_reminder", dueCount: -3 }) as { dueCount: number })
        .dueCount,
    ).toBe(0);
    expect(
      (parseNotifPayload("system", { kind: "vocab_due_reminder", dueCount: 4.9 }) as { dueCount: number })
        .dueCount,
    ).toBe(4);
  });

  it("system без kind (referral, data=null) → plain", () => {
    expect(parseNotifPayload("system", null)).toEqual({ kind: "plain" });
  });

  it("streak_reminder / weekly_digest → plain", () => {
    expect(parseNotifPayload("streak_reminder", null)).toEqual({ kind: "plain" });
    expect(parseNotifPayload("weekly_digest", { some: "thing" })).toEqual({ kind: "plain" });
  });

  it("кривой data (строка/число/массив) не роняет разбор → plain", () => {
    expect(parseNotifPayload("system", "oops")).toEqual({ kind: "plain" });
    expect(parseNotifPayload("system", 42)).toEqual({ kind: "plain" });
    expect(parseNotifPayload("system", ["vocab_due_reminder"])).toEqual({ kind: "plain" });
  });

  it("неизвестный type → plain", () => {
    expect(parseNotifPayload("wat", { kind: "vocab_due_reminder" })).toEqual({ kind: "plain" });
  });

  it("внешний/опасный href из jsonb → дефолтный внутренний путь", () => {
    for (const href of ["https://evil.example", "javascript:alert(1)", "//evil.example/x", "relative/path"]) {
      expect(parseNotifPayload("system", { kind: "vocab_due_reminder", href })).toEqual({
        kind: "vocab_due_reminder",
        href: "/app/vocabulary",
        dueCount: 0,
      });
    }
  });
});

describe("notifHref", () => {
  it("plain → null (некликабельно)", () => {
    expect(notifHref({ kind: "plain" })).toBeNull();
  });
  it("vocab / badge → их href", () => {
    expect(notifHref({ kind: "vocab_due_reminder", href: "/app/vocabulary", dueCount: 3 })).toBe(
      "/app/vocabulary",
    );
    expect(notifHref({ kind: "badge_unlocked", href: "/app/badges" })).toBe("/app/badges");
  });
});
