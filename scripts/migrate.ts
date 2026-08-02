/**
 * Minimal reversible migrator (up/down/idempotent) over hand-authored SQL in
 * /migrations/<name>/{up,down}.sql. Drizzle Kit's `generate` is forward-only,
 * but BRIEF §11 requires up/down — so this owns direction + bookkeeping while
 * src/db/schema.ts stays the typed source of truth.
 *
 * Bookkeeping table `_migrations` (excluded from app-table counts). Each step
 * runs as a single multi-statement simple query => one implicit transaction,
 * so a failure mid-file rolls back cleanly. Re-running `up` is a no-op
 * (idempotent) because applied names are skipped.
 */
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "migrations");

type Logger = (msg: string) => void;
const noop: Logger = () => {};

export function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => {
      try {
        return statSync(join(MIGRATIONS_DIR, name, "up.sql")).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

export async function ensureMigrationsTable(sql: Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (
    name       text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
}

export async function appliedMigrations(sql: Sql): Promise<string[]> {
  // Order by application time (not name) so a single-step `down` reverts the
  // chronologically-last migration even if names aren't lexically increasing.
  const rows = await sql<{ name: string }[]>`
    SELECT name FROM _migrations ORDER BY applied_at, name`;
  return rows.map((r) => r.name);
}

// Names are interpolated into the _migrations bookkeeping write (kept inside the
// file's single implicit transaction). They're operator-controlled directory
// names, but reject anything outside [0-9a-z_] so a stray quote can't break or
// desync bookkeeping.
function assertSafeName(name: string): void {
  if (!/^[0-9a-z_]+$/i.test(name)) {
    throw new Error(`Unsafe migration name: ${JSON.stringify(name)}`);
  }
}

/**
 * True if a Postgres connection string targets the local machine. Mirrors
 * verify.ts's isLocalDb. An unparseable string is treated as NON-local so the
 * destructive guard fails safe (refuse), never open.
 */
export function isLocalHost(connectionUrl: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(
      new URL(connectionUrl).hostname,
    );
  } catch {
    return false;
  }
}

/**
 * Guards the destructive `down` path. Reverting migrations against a non-local
 * host (the real Supabase database) drops the public schema and is almost always
 * an accident — so refuse unless the target is local OR the operator consciously
 * sets ALLOW_REMOTE_MIGRATE=1. `up` is never guarded: applying migrations to
 * production is a legitimate, non-destructive operation.
 */
export function assertLocalTarget(
  connectionUrl: string,
  allowRemote: boolean,
): void {
  if (allowRemote || isLocalHost(connectionUrl)) return;
  let host: string;
  try {
    host = new URL(connectionUrl).hostname;
  } catch {
    host = "(unparseable connection string)";
  }
  throw new Error(
    `Refusing to run a destructive migration command against a non-local host: ${host}. ` +
      `down drops the public schema and bootstrap overwrites auth primitives — never do ` +
      `this on a real Supabase database. Point DIRECT_URL at a local Postgres, or set ` +
      `ALLOW_REMOTE_MIGRATE=1 to override this consciously.`,
  );
}

const LOCAL_DEFAULT = "postgresql://postgres:postgres@localhost:5432/postgres";

/**
 * Resolves the migrator's target connection string. `--local` forces the throwaway
 * local Postgres (VERIFY_DATABASE_URL, else a localhost default) so destructive local
 * flows (db:down:local, round-trips) never need a hand-set $env:DIRECT_URL — the
 * fragile override that once silently pointed db:down at prod. Without `--local`,
 * prefer DIRECT_URL (session pooler) over DATABASE_URL, as before.
 */
export function resolveMigrationTarget(opts: {
  local: boolean;
  verifyUrl?: string;
  directUrl?: string;
  databaseUrl?: string;
}): string | undefined {
  if (opts.local) return opts.verifyUrl ?? LOCAL_DEFAULT;
  return opts.directUrl ?? opts.databaseUrl;
}

function readSql(name: string, dir: "up" | "down"): string {
  return readFileSync(join(MIGRATIONS_DIR, name, `${dir}.sql`), "utf8");
}

export async function migrateUp(sql: Sql, log: Logger = noop): Promise<number> {
  await ensureMigrationsTable(sql);
  const applied = new Set(await appliedMigrations(sql));
  let count = 0;
  for (const name of listMigrations()) {
    if (applied.has(name)) continue;
    assertSafeName(name);
    const body = readSql(name, "up");
    await sql.unsafe(
      `${body}\nINSERT INTO _migrations (name) VALUES ('${name}');`,
    );
    log(`  ↑ applied ${name}`);
    count++;
  }
  return count;
}

export async function migrateDown(
  sql: Sql,
  opts: { all?: boolean } = {},
  log: Logger = noop,
): Promise<number> {
  await ensureMigrationsTable(sql);
  const applied = await appliedMigrations(sql);
  const targets = (opts.all ? [...applied] : applied.slice(-1)).reverse();
  let count = 0;
  for (const name of targets) {
    assertSafeName(name);
    const body = readSql(name, "down");
    await sql.unsafe(
      `${body}\nDELETE FROM _migrations WHERE name = '${name}';`,
    );
    log(`  ↓ reverted ${name}`);
    count++;
  }
  return count;
}

export async function migrationStatus(sql: Sql): Promise<{
  all: string[];
  applied: string[];
  pending: string[];
}> {
  await ensureMigrationsTable(sql);
  const all = listMigrations();
  const applied = await appliedMigrations(sql);
  const appliedSet = new Set(applied);
  return { all, applied, pending: all.filter((n) => !appliedSet.has(n)) };
}

/* --------------------------------- CLI ----------------------------------- */
const invokedDirectly =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const { config } = await import("dotenv");
  const postgres = (await import("postgres")).default;
  config({ path: join(HERE, "..", ".env.local") });

  // Migrations use the session-mode connection (DIRECT_URL) when present; the
  // transaction pooler (DATABASE_URL) is for the app runtime. `--local` forces the
  // throwaway local Postgres so destructive local flows never touch the prod target.
  const url = resolveMigrationTarget({
    local: process.argv.includes("--local"),
    verifyUrl: process.env.VERIFY_DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
    databaseUrl: process.env.DATABASE_URL,
  });
  if (!url || url.trim() === "") {
    console.error(
      "Neither DIRECT_URL nor DATABASE_URL is set. Copy .env.example to .env.local.",
    );
    process.exit(1);
  }

  const cmd = process.argv[2] ?? "up";
  const all = process.argv.includes("--all");

  // Destructive-path host guard. `down` reverts ALL migrations (drops the public
  // schema); `bootstrap` overwrites Supabase auth primitives (incl. auth.uid()).
  // Both are catastrophic against the real database, so refuse them on a non-local
  // host unless ALLOW_REMOTE_MIGRATE=1 — the accidental remote `db:down` that wiped
  // prod is exactly what this prevents. Runs BEFORE connecting; `up`/`status` (safe
  // / non-destructive) are intentionally unguarded so prod migrations still apply.
  const DESTRUCTIVE = new Set(["down", "bootstrap"]);
  if (DESTRUCTIVE.has(cmd)) {
    try {
      assertLocalTarget(url, process.env.ALLOW_REMOTE_MIGRATE === "1");
    } catch (e) {
      console.error(`\n${(e as Error).message}\n`);
      process.exit(1);
    }
  }

  // prepare:false keeps this compatible with the Supabase connection pooler.
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  try {
    if (cmd === "up") {
      const n = await migrateUp(sql, console.log);
      console.log(n === 0 ? "Already up to date." : `Applied ${n} migration(s).`);
    } else if (cmd === "down") {
      const n = await migrateDown(sql, { all }, console.log);
      console.log(`Reverted ${n} migration(s).`);
    } else if (cmd === "status") {
      const s = await migrationStatus(sql);
      console.log("applied:", s.applied.join(", ") || "(none)");
      console.log("pending:", s.pending.join(", ") || "(none)");
    } else if (cmd === "bootstrap") {
      const body = readFileSync(
        join(HERE, "bootstrap-supabase-local.sql"),
        "utf8",
      );
      await sql.unsafe(body);
      console.log("Bootstrapped local Supabase primitives.");
    } else {
      console.error(`Unknown command: ${cmd} (use up | down | status | bootstrap)`);
      process.exit(1);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
