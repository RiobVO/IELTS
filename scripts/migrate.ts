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

  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local.");
    process.exit(1);
  }

  const cmd = process.argv[2] ?? "up";
  const all = process.argv.includes("--all");
  const sql = postgres(url, { max: 1, onnotice: () => {} });

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
