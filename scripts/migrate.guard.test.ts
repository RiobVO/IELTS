import { describe, it, expect } from "vitest";
import {
  isLocalHost,
  assertLocalTarget,
  resolveMigrationTarget,
} from "./migrate";

// Real-shaped connection strings (fake credentials). The Supabase pooler host is
// what the incident `db:down` actually hit; localhost/127.0.0.1 are the only safe
// destructive targets.
const PROD =
  "postgresql://postgres.oyecqbveatkolbqgfczq:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres";
const LOCAL = "postgresql://postgres:postgres@localhost:5432/postgres";
const LOOPBACK = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

describe("migrate host guard", () => {
  it("isLocalHost: true for localhost / 127.0.0.1, false for a remote Supabase host", () => {
    expect(isLocalHost(LOCAL)).toBe(true);
    expect(isLocalHost(LOOPBACK)).toBe(true);
    expect(isLocalHost(PROD)).toBe(false);
  });

  it("isLocalHost: false for an unparseable string (fail safe)", () => {
    expect(isLocalHost("not a connection string")).toBe(false);
  });

  it("assertLocalTarget: throws on a remote host without override", () => {
    expect(() => assertLocalTarget(PROD, false)).toThrow();
  });

  it("assertLocalTarget: allows a remote host only with the explicit override", () => {
    expect(() => assertLocalTarget(PROD, true)).not.toThrow();
  });

  it("assertLocalTarget: never blocks a local target", () => {
    expect(() => assertLocalTarget(LOCAL, false)).not.toThrow();
    expect(() => assertLocalTarget(LOOPBACK, false)).not.toThrow();
  });
});

describe("resolveMigrationTarget", () => {
  it("--local: uses VERIFY_DATABASE_URL (the throwaway local DB), never DIRECT_URL", () => {
    expect(
      resolveMigrationTarget({ local: true, verifyUrl: LOCAL, directUrl: PROD }),
    ).toBe(LOCAL);
  });

  it("--local without VERIFY_DATABASE_URL: falls back to a localhost default", () => {
    const r = resolveMigrationTarget({ local: true, directUrl: PROD });
    expect(isLocalHost(r!)).toBe(true);
  });

  it("default: prefers DIRECT_URL over DATABASE_URL", () => {
    expect(
      resolveMigrationTarget({ local: false, directUrl: PROD, databaseUrl: LOCAL }),
    ).toBe(PROD);
  });

  it("default: falls back to DATABASE_URL when DIRECT_URL is unset", () => {
    expect(resolveMigrationTarget({ local: false, databaseUrl: PROD })).toBe(PROD);
  });
});
