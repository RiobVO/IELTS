import { describe, it, expect } from "vitest";
import { isNextRedirectError } from "./is-redirect-error";

describe("isNextRedirectError", () => {
  it("распознаёт объект с digest, начинающимся на NEXT_REDIRECT", () => {
    expect(isNextRedirectError({ digest: "NEXT_REDIRECT;push;/app/reading/x/result;307;" })).toBe(true);
  });

  it("не путает обычную Error с redirect-ошибкой", () => {
    expect(isNextRedirectError(new Error("db timeout"))).toBe(false);
  });

  it("не путает Error с посторонним digest (не NEXT_REDIRECT-префикс)", () => {
    const e = Object.assign(new Error("x"), { digest: "SOME_OTHER_DIGEST" });
    expect(isNextRedirectError(e)).toBe(false);
  });

  it("устойчив к не-объектам / null / undefined", () => {
    expect(isNextRedirectError(null)).toBe(false);
    expect(isNextRedirectError(undefined)).toBe(false);
    expect(isNextRedirectError("NEXT_REDIRECT")).toBe(false);
    expect(isNextRedirectError(42)).toBe(false);
  });

  it("digest не-строкового типа не матчит", () => {
    expect(isNextRedirectError({ digest: 123 })).toBe(false);
  });
});
