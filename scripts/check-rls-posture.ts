/**
 * check-rls-posture — read-only проверка RLS-постуры каждой таблицы контракта
 * (TESTING_PLAN §6, волна 1.5 пакет B). В отличие от rls.db.test.ts НЕ трогает
 * данные и НЕ переключает роли: только читает каталоги
 * (pg_class.relrowsecurity + pg_policies + role_table_grants + column_privileges)
 * и сверяет их с общим контрактом (test/db/rls-contract.ts, mode "prod").
 *
 * СТРОГО read-only: ни одной пишущей операции, ни SET ROLE, ни DDL — безопасно
 * прогонять против прод-БД. Вход — RLS_POSTURE_DATABASE_URL (без дефолта на
 * DATABASE_URL: цель задаётся явно, чтобы случайно не ударить по рантайм-строке).
 *
 * Прод отличался от локали Supabase default-priv грантами (готча проекта);
 * после lockdown-миграций 0047/0048/0056/0057 дрейф снят везде, и контракт
 * строгий без исключений: anon/PUBLIC — ноль грантов на каждой таблице,
 * authenticated — empty либо ровно SELECT (+ контрактные колоночные UPDATE).
 * Рецидив дрейфа на любой таблице = [FAIL].
 *
 * Вывод: [OK]/[FAIL] по каждой таблице + агрегат; exit 0 только если всё чисто.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { checkPosture, RLS_CONTRACT } from "../test/db/rls-contract.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(ROOT, ".env.local") });

const url = process.env.RLS_POSTURE_DATABASE_URL;
if (!url || url.trim() === "") {
  console.error(
    "\nRLS_POSTURE_DATABASE_URL не задан. Укажите цель ЯВНО (без дефолта на " +
      "DATABASE_URL): строка подключения к проверяемой БД. Скрипт read-only.\n",
  );
  process.exit(1);
}

// prepare:false — безопасно против pgbouncer/session-pooler прод-строк.
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

async function main(): Promise<void> {
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

  if (failures === 0) {
    console.log(`\nexit 0 — ${RLS_CONTRACT.length} таблиц, постура чистая`);
    process.exit(0);
  }
  console.log(`\nexit 1 — ${failures} таблиц(ы) с нарушением постуры`);
  process.exit(1);
}

main().catch(async (e) => {
  console.error("\ncheck-rls-posture crashed:", e);
  try {
    await sql.end({ timeout: 5 });
  } catch {
    // already closed
  }
  process.exit(2);
});
