import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Тот же приём, что env.speaking.test.ts: load() бросает при импорте, если нет 4
// обязательных server-переменных, а vitest не подтягивает .env.local — стабим их
// перед динамическим импортом. emailDigestConfig сама читает только
// EMAIL_PROVIDER_API_KEY / EMAIL_FROM / EMAIL_FROM_NAME.
const REQUIRED_STUB = {
  SUPABASE_URL: "http://localhost",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  DATABASE_URL: "postgres://localhost/db",
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

describe("emailDigestConfig", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, REQUIRED_STUB);
    delete process.env.EMAIL_PROVIDER_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_FROM_NAME;
  });
  afterEach(() => { process.env = { ...saved }; });

  it("returns null when apiKey is missing", async () => {
    const { emailDigestConfig } = await import("./env");
    process.env.EMAIL_FROM = "noreply@example.com";
    expect(emailDigestConfig()).toBeNull();
  });

  it("returns null when from is missing", async () => {
    const { emailDigestConfig } = await import("./env");
    process.env.EMAIL_PROVIDER_API_KEY = "k";
    expect(emailDigestConfig()).toBeNull();
  });

  it("returns null when from is blank", async () => {
    const { emailDigestConfig } = await import("./env");
    process.env.EMAIL_PROVIDER_API_KEY = "k";
    process.env.EMAIL_FROM = "   ";
    expect(emailDigestConfig()).toBeNull();
  });

  it("returns {apiKey, from} when both are set and fromName omitted", async () => {
    const { emailDigestConfig } = await import("./env");
    process.env.EMAIL_PROVIDER_API_KEY = "k";
    process.env.EMAIL_FROM = "noreply@example.com";
    expect(emailDigestConfig()).toEqual({ apiKey: "k", from: "noreply@example.com" });
  });

  it("includes fromName when set", async () => {
    const { emailDigestConfig } = await import("./env");
    process.env.EMAIL_PROVIDER_API_KEY = "k";
    process.env.EMAIL_FROM = "noreply@example.com";
    process.env.EMAIL_FROM_NAME = "IELTS Prep";
    expect(emailDigestConfig()).toEqual({
      apiKey: "k",
      from: "noreply@example.com",
      fromName: "IELTS Prep",
    });
  });
});
