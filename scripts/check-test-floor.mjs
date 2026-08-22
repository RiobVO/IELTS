// Floor на количество тестов (TESTING_PLAN §5): детектор «CI зелёный, потому что
// тесты массово skipped или сьют вообще не собрался». Читает json-отчёт vitest
// (--reporter=json --outputFile=...). Пороги поднимать вручную при росте сьюта —
// floor держится чуть ниже фактического числа, чтобы обычное удаление пары тестов
// не красило CI, а исчезновение сотен — красило.
import { readFileSync } from "node:fs";

const MIN_PASSED = 1500; // факт на 2026-07-19: 1511 passed
const MAX_SKIPPED = 10; // факт: 4 skipped (реальные import-фикстуры, §11)

const path = process.argv[2] ?? "vitest-report.json";
let report;
try {
  report = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  console.error(`[FAIL] test floor: cannot read ${path}: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

const passed = report.numPassedTests;
const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
if (typeof passed !== "number") {
  console.error("[FAIL] test floor: numPassedTests missing in the vitest json report");
  process.exit(1);
}
if (passed < MIN_PASSED) {
  console.error(`[FAIL] test floor: ${passed} passed < ${MIN_PASSED} — the suite shrank or failed to collect`);
  process.exit(1);
}
if (skipped > MAX_SKIPPED) {
  console.error(`[FAIL] skipped ceiling: ${skipped} skipped > ${MAX_SKIPPED} — mass-skip masks a green run`);
  process.exit(1);
}
console.log(`[OK] test floor: ${passed} passed (>= ${MIN_PASSED}), ${skipped} skipped (<= ${MAX_SKIPPED})`);
