import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Calibration entry: a prompt + essay + human-assigned overall band (ground truth).
// Task 1 entries add taskPart:"task1" and imagePath (PNG/JPEG/WebP relative to the
// calibration file) so the benchmark feeds the same vision call as production.
interface CalibrationEntry {
  taskPrompt: string;
  essay: string;
  category: "academic" | "general";
  trueBand: number;
  taskPart?: "task1" | "task2";
  imagePath?: string;
}

const IMG_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Load a local chart file as the inline image bytes the evaluator expects. */
async function loadImage(absPath: string): Promise<{ data: string; mimeType: string }> {
  const ext = absPath.split(".").pop()?.toLowerCase() ?? "png";
  const buf = await readFile(absPath);
  return { data: buf.toString("base64"), mimeType: IMG_MIME[ext] ?? "image/png" };
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
// Mean signed error (pred − truth): a stable non-zero bias means the model leans high
// (+) or low (−) across the board — fixable by a constant offset, not a model swap.
// accuracy alone hides this: ±0.5 can pass while every estimate sits +0.4 too high.
export function meanBias(rows: { predMid: number; truth: number }[]): number {
  if (rows.length === 0) return 0;
  return rows.reduce((s, r) => s + (r.predMid - r.truth), 0) / rows.length;
}

const HERE = dirname(fileURLToPath(import.meta.url));

// Runner: only executed manually with a real set + key (ops-gate). Tests import the
// pure metrics above; this main() is not part of the test path. dotenv + getEvaluator
// are imported dynamically AFTER argv check so src/env.ts (which validates env at
// module load) doesn't fail when a test merely imports the metrics — same lazy-import
// discipline as scripts/migrate.ts (CLAUDE.md "Scripts gotcha").
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry transient API failures with exponential backoff: 429 (rate limit) and 5xx
// (500/503 — "high demand"/unavailable, common on Gemini Flash under load). Both clear
// on a short wait. Any other error (4xx, schema mismatch) rethrows immediately.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (!status || !RETRYABLE.has(status) || i >= attempts - 1) throw err;
      const wait = 2000 * 2 ** i;
      console.log(`    transient ${status}, retry in ${wait / 1000}s …`);
      await sleep(wait);
    }
  }
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    throw new Error("usage: tsx scripts/benchmark-writing.ts <calibration.json> [model,model,...]");
  }

  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: join(HERE, "..", ".env.local") });
  const { getEvaluator } = await import("@/lib/writing/evaluator");
  const { wordCount } = await import("@/lib/writing/word-count");

  const set: CalibrationEntry[] = JSON.parse(await readFile(path, "utf8"));
  const setDir = dirname(resolve(path)); // imagePath is relative to the calibration file
  // Candidate list from argv (comma-separated) or the single env model — same set runs
  // against every candidate for a fair head-to-head. evaluateWithGemini reads
  // WRITING_EVAL_MODEL lazily on each call, so swapping the env var here is enough.
  const envModel = process.env.WRITING_EVAL_MODEL;
  const models = (process.argv[3]?.split(",").map((m) => m.trim()).filter(Boolean)) ??
    (envModel ? [envModel] : []);
  if (models.length === 0) throw new Error("no models: pass a list as argv[3] or set WRITING_EVAL_MODEL");

  const evaluator = getEvaluator();
  console.log(`set: ${set.length} essays · candidates: ${models.join(", ")}\n`);

  for (const model of models) {
    process.env.WRITING_EVAL_MODEL = model;
    const rows: { predMid: number; truth: number }[] = [];
    let schemaOk = 0;
    console.log(`── ${model} ──`);
    for (const e of set) {
      try {
        const taskPart = e.taskPart ?? "task2";
        const image = e.imagePath ? await loadImage(join(setDir, e.imagePath)) : undefined;
        const r = await withRetry(() =>
          evaluator.evaluate({ essay: e.essay, taskPrompt: e.taskPrompt, category: e.category, taskPart, wordCount: wordCount(e.essay), image }),
        );
        schemaOk++;
        const predMid = bandMid(r.feedback);
        rows.push({ predMid, truth: e.trueBand });
        const hit = withinHalfBand(predMid, e.trueBand) ? "  " : "✗ ";
        console.log(`  ${hit}truth ${e.trueBand.toFixed(1)} → pred ${predMid.toFixed(2)} (${r.feedback.bandLow}–${r.feedback.bandHigh})`);
      } catch (err) {
        console.error("  eval failed for one entry:", err);
      }
    }
    console.log(`  schema-valid: ${schemaOk}/${set.length}`);
    console.log(`  band-accuracy (±0.5): ${(accuracy(rows) * 100).toFixed(1)}%`);
    console.log(`  mean bias (pred−truth): ${meanBias(rows) >= 0 ? "+" : ""}${meanBias(rows).toFixed(2)}\n`);
  }
  console.log("ACCEPTANCE: pick the candidate with the highest accuracy; a stable bias is");
  console.log("a calibration offset, not a disqualifier (note it for the prompt/post-process).");
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
