// Код привязки — единственное доказательство, что чат принадлежит аккаунту (G2-1).
// Слабая энтропия или предсказуемый хеш здесь означают чужие напоминания и чужие
// ошибки в чужом чате, поэтому свойства кода пиннятся тестом.
import { describe, it, expect } from "vitest";
import { generateLinkCode, hashLinkCode, LINK_CODE_TTL_MINUTES } from "./link-code";
import { parseStartPayload } from "./link-code";

describe("generateLinkCode", () => {
  it("даёт URL-безопасный код достаточной длины", () => {
    const code = generateLinkCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(encodeURIComponent(code)).toBe(code);
  });

  it("коды не повторяются", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateLinkCode()));
    expect(codes.size).toBe(200);
  });

  it("сгенерированный код проходит собственный парсер /start", () => {
    const code = generateLinkCode();
    expect(parseStartPayload(`/start ${code}`)).toBe(code);
  });
});

describe("hashLinkCode", () => {
  it("детерминирован — поиск по хешу вообще возможен", () => {
    expect(hashLinkCode("abc")).toBe(hashLinkCode("abc"));
  });

  it("разные коды дают разные хеши, и это не сам код", () => {
    expect(hashLinkCode("abc")).not.toBe(hashLinkCode("abd"));
    expect(hashLinkCode("abc")).not.toContain("abc");
    expect(hashLinkCode("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("TTL", () => {
  it("код живёт минуты, а не дни: успеть переключиться в Telegram", () => {
    expect(LINK_CODE_TTL_MINUTES).toBeGreaterThan(0);
    expect(LINK_CODE_TTL_MINUTES).toBeLessThanOrEqual(30);
  });
});
