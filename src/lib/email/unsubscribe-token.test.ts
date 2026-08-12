import { describe, it, expect } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

describe("signUnsubscribeToken / verifyUnsubscribeToken", () => {
  const secret = "test-secret";
  const userId = "user-123";

  it("round-trip: подписанный токен проходит проверку", () => {
    const token = signUnsubscribeToken(userId, secret);
    expect(verifyUnsubscribeToken(userId, token, secret)).toBe(true);
  });

  it("токен для другого userId не проходит", () => {
    const token = signUnsubscribeToken(userId, secret);
    expect(verifyUnsubscribeToken("user-456", token, secret)).toBe(false);
  });

  it("искажённый токен не проходит", () => {
    const token = signUnsubscribeToken(userId, secret);
    const tampered = token.slice(0, -1) + (token.at(-1) === "0" ? "1" : "0");
    expect(verifyUnsubscribeToken(userId, tampered, secret)).toBe(false);
  });

  it("secret null → false", () => {
    const token = signUnsubscribeToken(userId, secret);
    expect(verifyUnsubscribeToken(userId, token, null)).toBe(false);
  });

  it("secret пустой → false", () => {
    const token = signUnsubscribeToken(userId, secret);
    expect(verifyUnsubscribeToken(userId, token, "")).toBe(false);
  });

  it("token пустой → false", () => {
    expect(verifyUnsubscribeToken(userId, "", secret)).toBe(false);
  });

  it("userId пустой → false", () => {
    const token = signUnsubscribeToken(userId, secret);
    expect(verifyUnsubscribeToken("", token, secret)).toBe(false);
  });

  it("невалидный hex не бросает и возвращает false", () => {
    expect(() =>
      verifyUnsubscribeToken(userId, "not-a-valid-hex-token!!", secret),
    ).not.toThrow();
    expect(verifyUnsubscribeToken(userId, "not-a-valid-hex-token!!", secret)).toBe(
      false,
    );
  });
});
