import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Calibration entry: a prompt + essay + human-assigned overall band (ground truth).
interface CalibrationEntry {
  taskPrompt: string;
  essay: string;
  category: "academic" | "general";
  trueBand: number;
}

export function bandMid(r: { bandLow: number; bandHigh: number }): number {
  return (r.bandLow + r.bandHigh) / 2;
}
export function withinHalfBand(predMid: number, truth: number): boolean {
  return Math.abs(predMid - truth) <= 0.5;
}
export function accuracy(rows: { predMid: number; truth: number }[]): number {
  if (rows.length === 0) return 0;
  return rows.filter((r) => withinHalfBand(r.predMid, r.truth)).length / rows.length;
}

const HERE = dirname(fileURLToPath(import.meta.url));

// Runner: only executed manually with a real set + key (ops-gate). Tests import the
// pure metrics above; this main() is not part of the test path. dotenv + getEvaluator
// are imported dynamically AFTER argv check so src/env.ts (which validates env at
// module load) doesn't fail when a test merely imports the metrics — same lazy-import
// discipline as scripts/migrate.ts (CLAUDE.md "Scripts gotcha").
async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: tsx scripts/benchmark-writing.ts <calibration.json>");

  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: join(HERE, "..", ".env.local") });
  const { getEvaluator } = await import("@/lib/writing/evaluator");
  const { wordCount } = await import("@/lib/writing/word-count");

  const set: CalibrationEntry[] = JSON.parse(await readFile(path, "utf8"));
  const evaluator = getEvaluator();

  const rows: { predMid: number; truth: number }[] = [];
  let schemaOk = 0;
  for (const e of set) {
    try {
      const r = await evaluator.evaluate({ essay: e.essay, taskPrompt: e.taskPrompt, category: e.category, wordCount: wordCount(e.essay) });
      schemaOk++;
      rows.push({ predMid: bandMid(r.feedback), truth: e.trueBand });
    } catch (err) {
      console.error("eval failed for one entry:", err);
    }
  }
  console.log(`schema-valid: ${schemaOk}/${set.length}`);
  console.log(`band-accuracy (±0.5): ${(accuracy(rows) * 100).toFixed(1)}%`);
  console.log("ACCEPTANCE: candidate passes only if band-accuracy ≥ target on this set (spec gate).");
}

// Run only when invoked directly (tsx), never on import (keeps tests clean). Compare
// real paths (not `file://${process.argv[1]}`, which mismatches on Windows) — same
// self-invoke guard as scripts/migrate.ts.
const invokedDirectly =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
