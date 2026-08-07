/**
 * Acceptance gate (BRIEF VERIFY block). Prints [OK]/[FAIL] per check; exits 0
 * only if every check passes.
 *
 *   1. migrate up        -> all 27 app tables present
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

const APP_TABLE_COUNT = 28; // 13 from §5 + payment (2D) + annotation (0013) + leaderboard_snapshot (0014) + attempt_review_snapshot (0021) + signup_throttle (0022) + writing_task/submission/feedback/feedback_debug (Writing Lab, 0023) + speaking_task/submission/feedback/feedback_debug/audio_event (Speaking Lab, 0027) + error_log (0034)

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
async function tableLock(table: string): Promise<{
  rlsEnabled: boolean;
  noClientPolicy: boolean;
  anonDenied: boolean;
}> {
  const [{ rls }] = await sql<{ rls: boolean }[]>`
    SELECT relrowsecurity AS rls FROM pg_class
    WHERE oid = ${`public.${table}`}::regclass`;

  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ${table}
      AND (roles::text[] && ARRAY['anon','authenticated']
           OR 'public' = ANY(roles::text[]))`;

  let anonDenied = false;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE anon");
      await tx.unsafe(`SELECT * FROM ${table}`);
    });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    anonDenied = err?.code === "42501" || /permission denied/i.test(String(err?.message ?? e));
  }

  return { rlsEnabled: rls === true, noClientPolicy: n === 0, anonDenied };
}

/**
 * Column-level lock (0035): anon обязан получать 42501 на закрытых колонках,
 * при этом открытые каталожные колонки остаются читаемыми — строки фильтрует
 * RLS-политика, колонки — column-grants; держать должны ОБА слоя.
 */
async function columnLock(
  table: string,
  locked: string[],
  open: string[],
): Promise<{ lockedDenied: boolean; openAllowed: boolean; leaked: string[] }> {
  const leaked: string[] = [];
  for (const col of locked) {
    let denied = false;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE anon");
        await tx.unsafe(`SELECT ${col} FROM ${table} LIMIT 1`);
      });
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      denied = err?.code === "42501" || /permission denied/i.test(String(err?.message ?? e));
    }
    if (!denied) leaked.push(col);
  }
  let openAllowed = true;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE anon");
      await tx.unsafe(`SELECT ${open.join(", ")} FROM ${table} LIMIT 1`);
    });
  } catch {
    openAllowed = false;
  }
  return { lockedDenied: leaked.length === 0, openAllowed, leaked };
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

/**
 * Asserts the 0010 write-lockdown (BRIEF §6.1 / §4.6). RLS in 0001 is ROW-level
 * only, so the `authenticated` (anon-key) role could PATCH any column of its own
 * row — escalating privileges via profile.role or forging a score via a
 * straight-to-`submitted` attempt. After 0010 both must be denied at the GRANT
 * layer (42501), while SELECT and the owner-path (server-action) write keep
 * working. Inserts a throwaway auth user (trigger makes its profile); cleans up
 * via the auth.users cascade.
 */
async function clientWriteLockdown(): Promise<{
  profileUpdateDenied: boolean;
  attemptInsertDenied: boolean;
  ownerWriteWorks: boolean;
}> {
  const email = `verify-lock+${Date.now()}@example.com`;
  const [{ id }] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (email, raw_app_meta_data)
    VALUES (${email}, ${sql.json({ provider: "email" })})
    RETURNING id`;

  // Run one privileged write as the authenticated role (auth.uid() = this user)
  // and report whether it was denied with 42501 (permission). set_config(...,true)
  // is transaction-local and survives the SET LOCAL ROLE within the same tx.
  const deniedAsAuthenticated = async (
    write: (tx: postgres.TransactionSql) => Promise<unknown>,
  ): Promise<boolean> => {
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('request.jwt.claim.sub', ${id}, true)`;
        await tx.unsafe("SET LOCAL ROLE authenticated");
        await write(tx);
      });
      return false; // write succeeded -> NOT locked down
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      return err?.code === "42501" || /permission denied/i.test(String(err?.message ?? e));
    }
  };

  try {
    // (a) privilege escalation: patch own profile.role -> admin gate (auth.ts:48).
    const profileUpdateDenied = await deniedAsAuthenticated(
      (tx) => tx`UPDATE profile SET role = 'admin' WHERE id = ${id}`,
    );

    // (b) score forgery: insert a graded attempt straight to `submitted`, bypassing
    // server-side grading. Denied at the grant layer before any FK/row processing,
    // so a random content_item_id is fine.
    const attemptInsertDenied = await deniedAsAuthenticated(
      (tx) => tx`
        INSERT INTO attempt (user_id, content_item_id, mode, status, raw_score)
        VALUES (${id}, gen_random_uuid(), 'practice', 'submitted', 40)`,
    );

    // (c) legit path: the server action writes via the Drizzle OWNER role (this
    // connection) — a safe-field update must still succeed.
    const owner = await sql`UPDATE profile SET display_name = 'verify' WHERE id = ${id}`;
    const ownerWriteWorks = owner.count === 1;

    return { profileUpdateDenied, attemptInsertDenied, ownerWriteWorks };
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
  // Launch Next via the Node binary directly (node next/dist/bin/next ...) instead
  // of the node_modules/.bin/next shim: that shim is extensionless on Windows
  // (only next.cmd is runnable there) and Node >=20 refuses to spawn a .cmd without
  // shell:true — so spawning the shim path ENOENTs and the gate falsely fails.
  // Going through process.execPath is cross-platform and needs no shell.
  const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");
  // detached:true => child is its own process-group leader, so we can signal the
  // whole group (Next forks a router worker that actually binds the port; a bare
  // SIGKILL to the parent would orphan it).
  const child = spawn(
    process.execPath,
    [nextBin, "dev", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: ROOT,
      stdio: "ignore",
      detached: true,
      env: { ...process.env },
    },
  );
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

  // 1. migrate up -> APP_TABLE_COUNT tables
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
  const lock = await tableLock("answer_key");
  if (lock.rlsEnabled && lock.noClientPolicy && lock.anonDenied)
    ok("RLS — anon SELECT on answer_key denied");
  else
    fail(
      `RLS — answer_key not fully locked (rlsEnabled=${lock.rlsEnabled}, ` +
        `noClientPolicy=${lock.noClientPolicy}, anonDenied=${lock.anonDenied})`,
    );

  // 4b. attempt_review_snapshot locked the SAME way (D3): it holds correct
  // answers + evidence, so a client leak would bypass the answer_key lock and the
  // tier gate. Mirror of the answer_key assertion above.
  const snapLock = await tableLock("attempt_review_snapshot");
  if (snapLock.rlsEnabled && snapLock.noClientPolicy && snapLock.anonDenied)
    ok("RLS — anon SELECT on attempt_review_snapshot denied");
  else
    fail(
      `RLS — attempt_review_snapshot not fully locked (rlsEnabled=${snapLock.rlsEnabled}, ` +
        `noClientPolicy=${snapLock.noClientPolicy}, anonDenied=${snapLock.anonDenied})`,
    );

  // 4c. writing_feedback_debug + speaking_feedback_debug locked the SAME way: they hold
  // the raw model output (verbatim essay / transcript = PII + calibration data), so a
  // client read would leak it. Hard-locked like answer_key (migrations 0023 / 0027).
  for (const t of ["writing_feedback_debug", "speaking_feedback_debug"] as const) {
    const dbgLock = await tableLock(t);
    if (dbgLock.rlsEnabled && dbgLock.noClientPolicy && dbgLock.anonDenied)
      ok(`RLS — anon SELECT on ${t} denied`);
    else
      fail(
        `RLS — ${t} not fully locked (rlsEnabled=${dbgLock.rlsEnabled}, ` +
          `noClientPolicy=${dbgLock.noClientPolicy}, anonDenied=${dbgLock.anonDenied})`,
      );
  }

  // 4d. leaderboard_entry is authenticated-only (#18, migration 0033): anon must not read
  // user_id+rating via the REST endpoint, but logged-in users still see it (policy TO
  // authenticated USING true). NOT a full lock — an authenticated client policy exists by
  // design — so assert only RLS enabled + anon denied, guarding against a regress to the
  // old anon-readable policy.
  const lbLock = await tableLock("leaderboard_entry");
  if (lbLock.rlsEnabled && lbLock.anonDenied)
    ok("RLS — anon SELECT on leaderboard_entry denied");
  else
    fail(
      `RLS — leaderboard_entry not anon-locked (rlsEnabled=${lbLock.rlsEnabled}, ` +
        `anonDenied=${lbLock.anonDenied})`,
    );

  // 4e. error_log locked the SAME way as signup_throttle (#monitoring, migration 0034):
  // self-hosted error sink holds stack traces + urls (internal detail), owner-read only via
  // /admin/errors. Full lock — RLS on + no client policy + anon denied.
  const elLock = await tableLock("error_log");
  if (elLock.rlsEnabled && elLock.noClientPolicy && elLock.anonDenied)
    ok("RLS — anon SELECT on error_log denied");
  else
    fail(
      `RLS — error_log not fully locked (rlsEnabled=${elLock.rlsEnabled}, ` +
        `noClientPolicy=${elLock.noClientPolicy}, anonDenied=${elLock.anonDenied})`,
    );

  // 4f. content_item column-lock (N1/N9, 0035): runner_html защищён от утечки ключей
  // только import-time санитайзером, поэтому сама колонка (плюс служебные
  // source_file_path/import_warnings/reviewed_at/created_by) отрезана от клиентских
  // ролей грантами; каталожные колонки при этом остаются читаемыми.
  const ciLock = await columnLock(
    "content_item",
    ["runner_html", "source_file_path", "import_warnings", "reviewed_at", "created_by"],
    ["id", "title", "category", "duration_seconds", "tier_required", "status"],
  );
  if (ciLock.lockedDenied && ciLock.openAllowed)
    ok("grants — anon SELECT on content_item.runner_html/service columns denied; catalog columns readable");
  else
    fail(
      `grants — content_item column-lock broken (leaked=[${ciLock.leaked.join(", ")}], ` +
        `openAllowed=${ciLock.openAllowed})`,
    );

  // 5. auth trigger: a new auth.users row auto-creates a profile
  if (await profileAutoCreated())
    ok("auth trigger — profile auto-created on signup");
  else fail("auth trigger — profile NOT auto-created");

  // 6. write-lockdown (0010): authenticated can't escalate role or forge a score
  const lockdown = await clientWriteLockdown();
  if (
    lockdown.profileUpdateDenied &&
    lockdown.attemptInsertDenied &&
    lockdown.ownerWriteWorks
  )
    ok("RLS — authenticated denied profile.role patch + submitted-attempt forge; owner write works");
  else
    fail(
      `RLS — write-lockdown incomplete (profileUpdateDenied=${lockdown.profileUpdateDenied}, ` +
        `attemptInsertDenied=${lockdown.attemptInsertDenied}, ownerWriteWorks=${lockdown.ownerWriteWorks})`,
    );

  // 7. health endpoint
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
