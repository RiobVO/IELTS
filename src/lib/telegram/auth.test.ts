import { describe, it, expect } from "vitest";
import { webhookSecretValid } from "./auth";

// N12: сравнение secret-token — constant-time (timingSafeEqual), контракт матчинга
// не меняется: только точное совпадение проходит.
describe("webhookSecretValid", () => {
  it("совпадение → true", () => {
    expect(webhookSecretValid("s3cret", "s3cret")).toBe(true);
  });
  it("другое значение той же длины → false", () => {
    expect(webhookSecretValid("s3creT", "s3cret")).toBe(false);
  });
  it("другая длина → false (timingSafeEqual не бросает)", () => {
    expect(webhookSecretValid("s3", "s3cret")).toBe(false);
    expect(webhookSecretValid("s3cret-longer", "s3cret")).toBe(false);
  });
  it("null/undefined/пустая строка → false", () => {
    expect(webhookSecretValid(null, "s3cret")).toBe(false);
    expect(webhookSecretValid(undefined, "s3cret")).toBe(false);
    expect(webhookSecretValid("", "s3cret")).toBe(false);
  });
});
