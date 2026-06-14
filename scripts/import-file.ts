/**
 * CLI: parse a test HTML file and persist it into the database (status=draft).
 *   tsx scripts/import-file.ts <path-to-test.html>
 * The admin UI will do the same from the browser (BRIEF §4.2.1); this is the
 * headless equivalent for loading content.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const HERE = dirname(fileURLToPath(import.meta.url));
config({ path: join(HERE, "..", ".env.local") });

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx scripts/import-file.ts <path-to-test.html>");
  process.exit(1);
}

// Dynamic imports so dotenv loads before the DB client validates env.
const { parseTest } = await import("../src/lib/import/parse-test.ts");
const { persistTest } = await import("../src/lib/import/persist.ts");
const { db } = await import("../src/db/index.ts");
const { sql } = await import("drizzle-orm");

const parsed = parseTest(readFileSync(resolve(path), "utf8"));
console.log(
  `Parsed "${parsed.title}" — ${parsed.questions.length} questions, ${parsed.warnings.length} warning(s).`,
);
for (const w of parsed.warnings) console.log("  ⚠️ ", w);

const id = await persistTest(parsed, { sourceFilePath: path });

const rows = await db.execute(sql`
  SELECT
    (SELECT count(*)::int FROM passage   WHERE content_item_id = ${id}) AS passages,
    (SELECT count(*)::int FROM question  WHERE content_item_id = ${id}) AS questions,
    (SELECT count(*)::int FROM answer_key ak JOIN question q ON q.id = ak.question_id
       WHERE q.content_item_id = ${id}) AS answer_keys`);

console.log(`Persisted content_item ${id} (status=draft).`);
console.log("Verify counts:", rows[0] ?? rows);
process.exit(0);
