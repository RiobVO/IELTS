/**
 * Явный SETUP Storage тест-стенда (волна 2, TESTING_PLAN §7). Применяет КАНОН
 * (scripts/lib/storage-provisioning.ts) к hosted тест-проекту: приватные бакеты
 * `speaking-audio` (owner-политика) и `source-html` (без политики).
 *
 * Отдельно от контракт-теста намеренно: контракт-тест теперь READ-ONLY и падает
 * на дрейфе, а не чинит его. Провижининг — сюда. Таргет строго из .env.test.local
 * (loadTestTargetEnv, fail-fast на прод-ref), НИКОГДА .env.local.
 */
import postgres from "postgres";
import { loadTestTargetEnv } from "./lib/test-target-env.ts";
import { applyStorageProvisioning, STORAGE_BUCKETS } from "./lib/storage-provisioning.ts";

const t = loadTestTargetEnv();

async function main(): Promise<void> {
  console.log(`target: тест-проект ${t.ref} (hosted Supabase), storage SETUP\n`);
  const sql = postgres(t.directUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await applyStorageProvisioning(sql);
    console.log(
      `[OK] провижининг применён: ${STORAGE_BUCKETS.map((b) => b.id).join(", ")}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[FAIL]", e);
  process.exit(1);
});
