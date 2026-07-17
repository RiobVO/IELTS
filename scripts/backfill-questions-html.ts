/**
 * Недеструктивный backfill `passage.questions_html` для verbatim-рендера вопросов.
 * Re-парсит исходный HTML и обновляет ТОЛЬКО колонку questions_html у совпавшего по
 * title content_item — не трогает questions/answer_key/attempt (в отличие от re-import,
 * который их каскадно сносит). Грейдинг не меняется.
 *
 *   tsx scripts/backfill-questions-html.ts --list
 *   tsx scripts/backfill-questions-html.ts --file <path.html> [--apply]
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const HERE = dirname(fileURLToPath(import.meta.url));
config({ path: join(HERE, "..", ".env.local") });

const args = process.argv.slice(2);
const { db } = await import("../src/db/index.ts");
const { sql } = await import("drizzle-orm");

if (args.includes("--list")) {
  const rows = await db.execute(sql`
    SELECT ci.id, ci.title, ci.category, ci.status,
      (SELECT count(*)::int FROM passage p WHERE p.content_item_id = ci.id) AS passages,
      (SELECT count(*)::int FROM passage p WHERE p.content_item_id = ci.id AND p.questions_html IS NOT NULL) AS with_html,
      (SELECT count(*)::int FROM attempt a WHERE a.content_item_id = ci.id) AS attempts
    FROM content_item ci WHERE ci.section = 'reading' ORDER BY ci.created_at`);
  console.table(rows);
  process.exit(0);
}

const fileIdx = args.indexOf("--file");
const path = fileIdx >= 0 ? args[fileIdx + 1] : null;
const apply = args.includes("--apply");
if (!path) {
  console.error("usage: --list | --file <path.html> [--apply]");
  process.exit(1);
}

const { parseTest } = await import("../src/lib/import/parse-test.ts");
const parsed = await parseTest(readFileSync(resolve(path), "utf8"));
const captured = parsed.passages.filter((p) => p.questionsHtml);
console.log(`Parsed "${parsed.title}" (${parsed.section}) — passages ${parsed.passages.length}, captured ${captured.length}`);
if (captured.length === 0) {
  console.log("No questions_html captured — nothing to backfill (falls back to atomized list).");
  process.exit(0);
}

const cis = await db.execute(
  sql`SELECT id, title, status FROM content_item WHERE title = ${parsed.title} AND section = ${parsed.section}`,
);
console.log(`Matched content_items by title: ${cis.length}`);
for (const ci of cis) console.log("  -", ci.id, `[${ci.status}]`, ci.title);
if (cis.length === 0) {
  console.log("No content_item matched this title — skip.");
  process.exit(0);
}

for (const ci of cis) {
  for (const p of parsed.passages) {
    if (!p.questionsHtml) continue;
    if (apply) {
      await db.execute(
        sql`UPDATE passage SET questions_html = ${p.questionsHtml} WHERE content_item_id = ${ci.id} AND "order" = ${p.order}`,
      );
    }
    console.log(`  ${apply ? "UPDATED" : "would update"} ci=${ci.id} order=${p.order} (${p.questionsHtml.length} chars)`);
  }
}
console.log(apply ? "✅ Backfill applied." : "Dry-run — pass --apply to write.");
process.exit(0);
