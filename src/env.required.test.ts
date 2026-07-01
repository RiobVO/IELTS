import { describe, it, expect, afterEach, vi } from "vitest";

// #23: публичная пара NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY используется браузерными
// @supabase/ssr-клиентами через `!` (client/server/middleware.ts), но раньше не была
// в REQUIRED — отсутствие ловилось не централизованно, а рантайм-крашем. Теперь
// load() обязан fail-fast и на них. resetModules — чтобы load() перевыполнялся на
// каждый импорт (обычно `export const env = load()` кешируется на файл).
const FULL_STUB: Record<string, string> = {
  SUPABASE_URL: "http://localhost",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  DATABASE_URL: "postgres://localhost/db",
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

describe("env load() — fail-fast на публичной Supabase-паре (#23)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });

  it("бросает, когда NEXT_PUBLIC_SUPABASE_URL отсутствует", async () => {
    vi.resetModules();
    Object.assign(process.env, FULL_STUB);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await expect(import("./env")).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("бросает, когда NEXT_PUBLIC_SUPABASE_ANON_KEY пустой", async () => {
    vi.resetModules();
    Object.assign(process.env, FULL_STUB);
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
    await expect(import("./env")).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("грузится, когда заданы все required (включая публичную пару)", async () => {
    vi.resetModules();
    Object.assign(process.env, FULL_STUB);
    await expect(import("./env")).resolves.toBeDefined();
  });
});
