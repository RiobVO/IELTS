// Проводка signUp → атомарный velocity-cap (аудит 2026-07-17, minor #4).
// Регресс, который ловим: патч мог добавить scope "signup" в AUTH_THROTTLE_LIMITS,
// но оставить signUp на старом неатомарном inline-пути — конкурентный DB-тест
// helper'а такого не заметит (helper и так атомарен). Здесь фиксируем сам факт
// подключения: исчерпанный лимит останавливает регистрацию ДО supabase.auth.signUp.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { throttleMock, verifyTurnstileMock, authSignUpMock, createClientMock, captureMock, logErrorMock, revalidatePathMock } = vi.hoisted(() => ({
  throttleMock: vi.fn(),
  verifyTurnstileMock: vi.fn(),
  authSignUpMock: vi.fn(),
  createClientMock: vi.fn(),
  captureMock: vi.fn(),
  logErrorMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));
vi.mock("@/lib/anti-bot/ip-throttle", () => ({ checkIpThrottle: throttleMock }));
vi.mock("@/lib/anti-bot/turnstile", () => ({ verifyTurnstile: verifyTurnstileMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/env", () => ({ publicSiteUrl: () => "https://bando.study" }));
vi.mock("@/lib/analytics/server", () => ({ captureServer: captureMock }));
vi.mock("@/lib/monitoring/log-error", () => ({ logError: logErrorMock }));
// revalidatePath вне request-скоупа Next бросает — мокаем, как publish.test.ts.
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
// redirect в Next бросает — реплицируем, чтобы видеть точку выхода action'а.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { signUp } from "./actions";

// Честная форма живого пользователя: honeypot-поле "website" пусто.
function signupForm(): FormData {
  const fd = new FormData();
  fd.set("email", "user@test.local");
  fd.set("password", "correct-horse-battery");
  return fd;
}

beforeEach(() => {
  [throttleMock, verifyTurnstileMock, authSignUpMock, createClientMock, captureMock, logErrorMock, revalidatePathMock].forEach((m) => m.mockReset());
  verifyTurnstileMock.mockResolvedValue(true);
  createClientMock.mockResolvedValue({ auth: { signUp: authSignUpMock } });
});

describe("signUp × velocity-cap", () => {
  it("исчерпанный лимит: отказ ДО supabase.auth.signUp, helper зовётся со scope signup", async () => {
    throttleMock.mockResolvedValue(true);
    await expect(signUp(signupForm())).rejects.toThrow(/REDIRECT:\/auth\?.*Too\+many\+sign-ups/);
    expect(throttleMock).toHaveBeenCalledWith("signup");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("под лимитом: регистрация доходит до supabase.auth.signUp ровно один раз", async () => {
    throttleMock.mockResolvedValue(false);
    // session:null + пустые identities = анти-энумерационный ответ Supabase →
    // ветка «Check your email» без captureServer, самый короткий успешный путь.
    authSignUpMock.mockResolvedValue({ data: { session: null, user: { id: "u1", identities: [] } }, error: null });
    await expect(signUp(signupForm())).rejects.toThrow(/REDIRECT:\/auth\/check-email/);
    expect(authSignUpMock).toHaveBeenCalledTimes(1);
    expect(captureMock).not.toHaveBeenCalled();
  });
});
