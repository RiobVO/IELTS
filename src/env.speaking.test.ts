import { describe, it, expect, beforeEach, afterEach } from "vitest";

// env.ts runs load() at import time (throws unless the 4 REQUIRED server vars are
// present) and vitest does NOT load .env.local into process.env — so stub them before
// dynamically importing the module under test. speakingEvalConfig itself only reads
// GEMINI_API_KEY / SPEAKING_EVAL_MODEL.
const REQUIRED_STUB = {
  SUPABASE_URL: "http://localhost",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  DATABASE_URL: "postgres://localhost/db",
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

describe("speakingEvalConfig", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, REQUIRED_STUB);
    delete process.env.GEMINI_API_KEY;
    delete process.env.SPEAKING_EVAL_MODEL;
  });
  afterEach(() => { process.env = { ...saved }; });

  it("returns null when either var is missing", async () => {
    const { speakingEvalConfig } = await import("./env");
    process.env.GEMINI_API_KEY = "k";
    expect(speakingEvalConfig()).toBeNull();
  });

  it("returns {apiKey, model} when both are set", async () => {
    const { speakingEvalConfig } = await import("./env");
    process.env.GEMINI_API_KEY = "k";
    process.env.SPEAKING_EVAL_MODEL = "gemini-2.5-flash";
    expect(speakingEvalConfig()).toEqual({ apiKey: "k", model: "gemini-2.5-flash" });
  });
});
