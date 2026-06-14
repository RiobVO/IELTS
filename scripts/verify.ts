/**
 * Acceptance gate (BRIEF VERIFY block). Prints [OK]/[FAIL] per check; exits 0
 * only if every check passes.
 *
 *   1. migrate up        -> all 13 app tables present
 *   2. migrate down      -> clean revert (0 app tables)
 *   3. migrate up again  -> idempotent (re-apply works, second run is a no-op)
 *   4. anon role         -> SELECT * FROM answer_key is DENIED by RLS
 *   5. auth trigger      -> new auth.users row auto-creates a profile
 *   6. GET /api/health   -> 200
 *
 * Requires a reachable DATABASE_URL (Supabase or local docker Postgres) and all
 * required env vars. Fails fast with a clear message if any env var is missing.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { migrateDown, migrateUp } from "./migrate.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

loadEnv({ path: join(ROOT, ".env.local") });

const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
] as const;

const APP_TABLE_COUNT = 13;

let failures = 0;
const ok = (msg: string) => console.log(`[OK] ${msg}`);
const fail = (msg: string) => {
  console.log(`[FAIL] ${msg}`);
  failures++;
};

// --- 0. env (fail fast) ----------------------------------------------------
const missing = REQUIRED.filter(
  (k) => !process.env[k] || process.env[k]!.trim() === "",
);
if (missing.length > 0) {
  console.error(`\nMissing required env var(s): ${missing.join(", ")}`);
  console.error("Set them in .env.local (see .env.example). Never hardcode secrets.\n");
  process.exit(1);
}

// Verify is DESTRUCTIVE (drops/recreates the public schema, and the bootstrap
// overwrites auth.uid()). It must target a THROWAWAY local DB — never the real
// Supabase project. Prefer VERIFY_DATABASE_URL; refuse a non-local target.
const VERIFY_DB = process.env.VERIFY_DATABASE_URL ?? process.env.DATABASE_URL!;
function isLocalDb(u: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(u).hostname);
  } catch {
    return false;
  }
}
if (!isLocalDb(VERIFY_DB) && process.env.VERIFY_ALLOW_REMOTE !== "1") {
  console.error(
    "\nRefusing to run the destructive verify gate against a non-local database:\n  " +
      VERIFY_DB.replace(/:\/\/([^:@/]+):[^@/]+@/, "://$1:****@") +
      "\nPoint VERIFY_DATABASE_URL at a local Postgres (npm run docker:db), " +
      "or set VERIFY_ALLOW_REMOTE=1 to override.\n",
  );
  process.exit(1);
}

const sql = postgres(VERIFY_DB, { max: 1, onnotice: () => {} });

async function countAppTables(): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name !~ '^_'`;
  return rows[0].n;
}

async function resetPublicSchema(): Promise<void> {
  // Pristine starting point. auth schema + roles (created by bootstrap) live
  // outside public and survive.
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO postgres;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  `);
}

/**
 * Asserts answer_key is locked the way BRIEF §6.1 requires — not just that anon
 * happens to be denied. A REVOKE alone raises 42501 regardless of RLS, so we
 * positively check all three layers, otherwise an accidental `RLS DISABLE`
 * regression would still pass:
 *   - RLS is ENABLED on answer_key (pg_class.relrowsecurity),
 *   - there is NO policy granting anon/authenticated access, and
 *   - an actual anon SELECT is denied.
 */
async function answerKeyLock(): Promise<{
  rlsEnabled: boolean;
  noClientPolicy: boolean;
  anonDenied: boolean;
}> {
  const [{ rls }] = await sql<{ rls: boolean }[]>`
    SELECT relrowsecurity AS rls FROM pg_class
    WHERE oid = 'public.answer_key'::regclass`;

  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'answer_key'
      AND (roles::text[] && ARRAY['anon','authenticated']
           OR 'public' = ANY(roles::text[]))`;

  let anonDenied = false;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE anon");
      await tx.unsafe("SELECT * FROM answer_key");
    });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    anonDenied = err?.code === "42501" || /permission denied/i.test(String(err?.message ?? e));
  }

  return { rlsEnabled: rls === true, noClientPolicy: n === 0, anonDenied };
}

/**
 * Inserts a fake auth user and checks the 0002 trigger auto-creates a matching
 * profile with the expected defaults (role=student, tier=basic, referral_code),
 * then cleans up (cascade removes the profile).
 */
async function profileAutoCreated(): Promise<boolean> {
  const email = `verify+${Date.now()}@example.com`;
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO auth.users (email, raw_app_meta_data)
    VALUES (${email}, ${sql.json({ provider: "email" })})
    RETURNING id`;
  const id = inserted[0].id;
  try {
    const rows = await sql<
      { role: string; tier: string; referral_code: string | null }[]
    >`SELECT role::text AS role, tier::text AS tier, referral_code
        FROM profile WHERE id = ${id}`;
    return (
      rows.length === 1 &&
      rows[0].role === "student" &&
      rows[0].tier === "basic" &&
      !!rows[0].referral_code
    );
  } finally {
    await sql`DELETE FROM auth.users WHERE id = ${id}`;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function checkHealth(): Promise<boolean> {
  // Ephemeral port avoids colliding with / false-passing against a stale server
  // from a previous run.
  const port = await freePort();
  const nextBin = join(ROOT, "node_modules", ".bin", "next");
  // detached:true => child is its own process-group leader, so we can signal the
  // whole group (Next forks a router worker that actually binds the port; a bare
  // SIGKILL to the parent would orphan it).
  const child = spawn(nextBin, ["dev", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT,
    stdio: "ignore",
    detached: true,
    env: { ...process.env },
  });
  let childDead = false;
  child.on("exit", () => {
    childDead = true;
  });
  child.on("error", () => {
    childDead = true;
  });
  try {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (childDead) return false; // server died before serving => real failure
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (res.status === 200) return true;
      } catch {
        // server not up yet
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  } finally {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL"); // whole group
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}

async function main() {
  // Local Supabase primitives (roles, auth schema/users, auth.uid()).
  await sql.unsafe(readFileSync(join(HERE, "bootstrap-supabase-local.sql"), "utf8"));
  await resetPublicSchema();

  // 1. migrate up -> 13 tables
  await migrateUp(sql);
  let n = await countAppTables();
  if (n === APP_TABLE_COUNT) ok(`migrate up — ${n} tables created`);
  else fail(`migrate up — expected ${APP_TABLE_COUNT} tables, found ${n}`);

  // 2. migrate down -> clean revert
  await migrateDown(sql, { all: true });
  n = await countAppTables();
  if (n === 0) ok("migrate down — reverted cleanly");
  else fail(`migrate down — ${n} table(s) left behind`);

  // 3. migrate up (re-apply) + idempotent re-run
  await migrateUp(sql);
  const secondRun = await migrateUp(sql); // must apply 0
  n = await countAppTables();
  if (n === APP_TABLE_COUNT && secondRun === 0)
    ok("migrate up (re-apply) — idempotent");
  else
    fail(`migrate up (re-apply) — tables=${n}, second run applied=${secondRun}`);

  // 4. answer_key locked (BRIEF §6.1): RLS enabled + no anon/auth policy + anon denied
  const lock = await answerKeyLock();
  if (lock.rlsEnabled && lock.noClientPolicy && lock.anonDenied)
    ok("RLS — anon SELECT on answer_key denied");
  else
    fail(
      `RLS — answer_key not fully locked (rlsEnabled=${lock.rlsEnabled}, ` +
        `noClientPolicy=${lock.noClientPolicy}, anonDenied=${lock.anonDenied})`,
    );

  // 5. auth trigger: a new auth.users row auto-creates a profile
  if (await profileAutoCreated())
    ok("auth trigger — profile auto-created on signup");
  else fail("auth trigger — profile NOT auto-created");

  // 6. health endpoint
  if (await checkHealth()) ok("/api/health — 200");
  else fail("/api/health — did not return 200");
}

main()
  .then(async () => {
    await sql.end({ timeout: 5 });
    if (failures === 0) {
      console.log("exit 0");
      process.exit(0);
    } else {
      console.log(`exit 1 (${failures} check[s] failed)`);
      process.exit(1);
    }
  })
  .catch(async (e) => {
    console.error("\nverify crashed:", e);
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // ignore
    }
    process.exit(2);
  });
