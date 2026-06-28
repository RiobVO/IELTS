import { describe, it, expect } from "vitest";
import { isLocalHost, assertLocalTarget } from "./migrate";

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
