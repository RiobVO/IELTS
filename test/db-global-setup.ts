import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { migrateUp } from "../scripts/migrate.ts";
import { resolveDbTestTarget } from "./db-target.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Готовит throwaway-БД ОДИН раз на прогон test:db (vitest globalSetup,
 * main-процесс): bootstrap → reset public → чистый auth.users → migrateUp с нуля.
 *
 * Порядок неслучаен: bootstrap (роли anon/authenticated/service_role + auth
 * schema, идемпотентен, public не трогает) обязан идти ДО reset'а — GRANT'ы
 * reset'а требуют этих ролей на свежей БД. DROP public CASCADE сносит и
 * `_migrations`, поэтому migrateUp честно переприменяет весь набор (тот же
 * цикл, что verify.ts). env-переменные воркеров отсюда не выставить (другой
 * процесс) — этим занимается test/db-setup.ts (setupFiles).
 */
export default async function globalSetup(): Promise<void> {
  const url = resolveDbTestTarget();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(
      readFileSync(join(ROOT, "scripts", "bootstrap-supabase-local.sql"), "utf8"),
    );
    await sql.unsafe(`
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO postgres;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    `);
    // Сид прошлых прогонов; profile/payment уже снесены reset'ом, каскадить нечего.
    await sql`TRUNCATE auth.users CASCADE`;
    await migrateUp(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
