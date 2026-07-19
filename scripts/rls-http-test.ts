/**
 * Раннер IDOR-матрицы против hosted тест-стенда Supabase через РЕАЛЬНЫЙ
 * PostgREST+Auth (волна 2, TESTING_PLAN §7). Тонкая запускалка: env только
 * через loadTestTargetEnv (fail-fast на прод-ref) → runIdorMatrix → построчный
 * [OK]/[FAIL]/[SKIP] → exit 0/1. Формат зеркалит rls-posture-test.ts.
 */
import { loadTestTargetEnv } from "./lib/test-target-env.ts";
import { runIdorMatrix } from "../test/hosted/rls-http.ts";

async function main(): Promise<void> {
  const env = loadTestTargetEnv();
  console.log(`target: тест-проект ${env.ref} (hosted Supabase), IDOR через PostgREST+Auth\n`);

  const { passed, failed, results } = await runIdorMatrix(env);

  for (const r of results) {
    if (r.status === "PASS") {
      console.log(`[OK] ${r.table} (${r.category}) — ${r.vectors.length} векторов доказано`);
      for (const v of r.vectors) console.log(`       · ${v}`);
    } else if (r.status === "SKIPPED") {
      console.log(`[SKIP] ${r.table} (${r.category}) — ${r.reason}`);
    } else {
      console.log(`[FAIL] ${r.table} (${r.category}): ${r.problems.join("; ")}`);
    }
  }

  const skipped = results.filter((r) => r.status === "SKIPPED");
  console.log(
    `\nитого: ${passed} PASS, ${failed} FAIL, ${skipped.length} SKIP (из ${results.length} таблиц)`,
  );
  if (skipped.length > 0) {
    console.log(`SKIPPED: ${skipped.map((r) => `${r.table} (${r.reason})`).join(", ")}`);
  }

  // SKIP — тоже красный (Codex High #1): пропущенная таблица (новая в
  // RLS_CONTRACT / переименованный ключ посева) означает НЕпроверенную изоляцию,
  // а не «чисто». Зелёным считаем только полное покрытие контракта пробами.
  if (failed === 0 && skipped.length === 0) {
    console.log("\nexit 0 — IDOR-матрица чистая, все таблицы контракта покрыты");
    process.exit(0);
  }
  const reasons = [
    failed > 0 ? `${failed} с пробитой изоляцией` : null,
    skipped.length > 0 ? `${skipped.length} не покрыто пробами (SKIP)` : null,
  ].filter(Boolean);
  console.log(`\nexit 1 — ${reasons.join(", ")}`);
  process.exit(1);
}

main().catch((e) => {
  console.error("\nrls-http-test crashed:", e);
  process.exit(2);
});
