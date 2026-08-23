/**
 * Прогон миграций против hosted тест-стенда Supabase (волна 2, TESTING_PLAN §7).
 * НЕ трогает прод: таргет берётся строго из `.env.test.local` через
 * loadTestTargetEnv (fail-fast на прод-ref), а не из .env.local. Только up/status
 * — деструктивные down/bootstrap здесь недоступны намеренно (для round-trip'ов
 * есть db:*:local на throwaway PG).
 */
import postgres from "postgres";
import { loadTestTargetEnv } from "./lib/test-target-env.ts";
import { migrateUp, migrationStatus } from "./migrate.ts";

const t = loadTestTargetEnv();
// Миграции идут через session-pooler (DIRECT_URL), как и на проде.
const sql = postgres(t.directUrl, { max: 1, prepare: false, onnotice: () => {} });
const cmd = process.argv[2] ?? "up";

try {
  console.log(`target: тест-проект ${t.ref} (hosted Supabase)`);
  if (cmd === "up") {
    const n = await migrateUp(sql, console.log);
    console.log(n === 0 ? "Already up to date." : `Applied ${n} migration(s).`);
  } else if (cmd === "status") {
    const s = await migrationStatus(sql);
    console.log("applied:", s.applied.join(", ") || "(none)");
    console.log("pending:", s.pending.join(", ") || "(none)");
  } else {
    console.error(`Unknown command: ${cmd} (use up | status)`);
    process.exit(1);
  }
} finally {
  await sql.end({ timeout: 5 });
}
