/**
 * RLS-постура hosted тест-стенда (волна 2, TESTING_PLAN §7). Тот же read-only
 * контракт, что check-rls-posture.ts (mode "prod"), но таргет — тест-проект из
 * `.env.test.local` (loadTestTargetEnv, fail-fast на прод-ref), не
 * RLS_POSTURE_DATABASE_URL. Сверяет relrowsecurity + pg_policies +
 * role_table_grants + column_privileges с общим RLS_CONTRACT. Строго read-only.
 */
import postgres from "postgres";
import { loadTestTargetEnv } from "./lib/test-target-env.ts";
import { checkPosture, RLS_CONTRACT } from "../test/db/rls-contract.ts";

const t = loadTestTargetEnv();
const sql = postgres(t.directUrl, { max: 1, prepare: false, onnotice: () => {} });

async function main(): Promise<void> {
  console.log(`target: тест-проект ${t.ref} (hosted Supabase), read-only\n`);
  let failures = 0;
  for (const c of RLS_CONTRACT) {
    const r = await checkPosture(sql, c, "prod");
    if (r.ok) {
      console.log(`[OK] ${c.table} — постура соответствует контракту`);
    } else {
      failures++;
      console.log(`[FAIL] ${c.table}: ${r.problems.join("; ")}`);
    }
  }
  await sql.end({ timeout: 5 });
  if (failures === 0) {
    console.log(`\nexit 0 — ${RLS_CONTRACT.length} таблиц, постура чистая`);
    process.exit(0);
  }
  console.log(`\nexit 1 — ${failures} таблиц(ы) с нарушением постуры`);
  process.exit(1);
}

main().catch(async (e) => {
  console.error("\nrls-posture-test crashed:", e);
  try {
    await sql.end({ timeout: 5 });
  } catch {
    // already closed
  }
  process.exit(2);
});
