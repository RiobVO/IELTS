import { describe, it, expect, beforeEach, afterEach } from "vitest";

// env.ts runs load() at import time (throws unless the 4 REQUIRED server vars are
// present) and vitest does NOT load .env.local — so stub them before dynamically
// importing the module. The feature gate must require ALL of: model+key, internal
// secret AND public origin (the desync: a submission is created but triggerEvaluate
// silently no-ops without origin/secret → reaped to failed).
const REQUIRED_STUB = {
  SUPABASE_URL: "http://localhost",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  DATABASE_URL: "postgres://localhost/db",
};

describe("writingFeatureEnabled / speakingFeatureEnabled", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, REQUIRED_STUB);
    for (const k of [
      "GEMINI_API_KEY",
      "WRITING_EVAL_MODEL",
      "SPEAKING_EVAL_MODEL",
      "WRITING_INTERNAL_SECRET",
      "CRON_SECRET",
      "NEXT_PUBLIC_SITE_URL",
    ]) {
      delete process.env[k];
    }
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("writing: disabled when model+key set but secret+origin missing", async () => {
    const { writingFeatureEnabled } = await import("./env");
    process.env.GEMINI_API_KEY = "k";
    process.env.WRITING_EVAL_MODEL = "m";
    expect(writingFeatureEnabled()).toBe(false);
  });

  it("writing: enabled when model+key+secret+origin all set", async () => {
    const { writingFeatureEnabled } = await import("./env");
    process.env.GEMINI_API_KEY = "k";
    process.env.WRITING_EVAL_MODEL = "m";
    process.env.WRITING_INTERNAL_SECRET = "s";
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
    expect(writingFeatureEnabled()).toBe(true);
  });

  it("speaking: disabled when model+key set but secret+origin missing", async () => {
    const { speakingFeatureEnabled } = await import("./env");
    process.env.GEMINI_API_KEY = "k";
    process.env.SPEAKING_EVAL_MODEL = "m";
    expect(speakingFeatureEnabled()).toBe(false);
  });

  it("speaking: enabled when model+key+secret(CRON)+origin all set", async () => {
    const { speakingFeatureEnabled } = await import("./env");
    process.env.GEMINI_API_KEY = "k";
    process.env.SPEAKING_EVAL_MODEL = "m";
    process.env.CRON_SECRET = "s"; // speakingInternalSecret reuses CRON_SECRET
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
    expect(speakingFeatureEnabled()).toBe(true);
  });
});
