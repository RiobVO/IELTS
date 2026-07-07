// Юнит-тесты isEmailNotConfirmed — детектор ошибки Supabase, по которому signIn
// решает увести на экран подтверждения (с resend) вместо сырой ошибки в форме.
import { describe, it, expect } from "vitest";
import { isEmailNotConfirmed } from "./email-confirm";

describe("isEmailNotConfirmed", () => {
  it("матчит сообщение Supabase в любом регистре", () => {
    expect(isEmailNotConfirmed("Email not confirmed")).toBe(true);
    expect(isEmailNotConfirmed("email not confirmed")).toBe(true);
    expect(isEmailNotConfirmed("EMAIL NOT CONFIRMED")).toBe(true);
    // Реальный текст может нести префикс/суффикс — важна подстрока.
    expect(isEmailNotConfirmed("AuthApiError: Email not confirmed")).toBe(true);
  });

  it("не матчит прочие auth-ошибки", () => {
    expect(isEmailNotConfirmed("Invalid login credentials")).toBe(false);
    expect(isEmailNotConfirmed("User already registered")).toBe(false);
    expect(isEmailNotConfirmed("Email rate limit exceeded")).toBe(false);
    expect(isEmailNotConfirmed("")).toBe(false);
  });

  it("безопасен к null/undefined", () => {
    expect(isEmailNotConfirmed(null)).toBe(false);
    expect(isEmailNotConfirmed(undefined)).toBe(false);
  });
});
