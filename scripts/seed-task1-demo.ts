/**
 * Сидирует прод-каталог опубликованными темами Writing Task 1 из сгенерированных
 * графиков (content/writing-task1/<slug>.{png,json}). Загружает картинку в Storage
 * owner-path и вставляет writing_task (task_part=task1, category=academic, image_path,
 * prompt из JSON). Идемпотентно: ключ Storage детерминирован (seed-<slug>.png),
 * повторная вставка той же темы пропускается. Контент-сид, не часть рантайма.
 *
 * Запуск:  npx tsx scripts/seed-task1-demo.ts
 *
 * Динамические импорты ПОСЛЕ dotenv (src/env.ts валидирует env при импорте —
 * CLAUDE.md «Scripts gotcha»).
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "content", "writing-task1");

async function main() {
  const { config } = await import("dotenv");
  config({ path: join(HERE, "..", ".env.local") });
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/db");
  const { writingTask } = await import("@/db/schema");
  const { uploadTask1Image } = await import("@/lib/writing/storage");

  const slugs = (await readdir(DIR)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  let seeded = 0;
  let skipped = 0;

  for (const slug of slugs) {
    const meta = JSON.parse(await readFile(join(DIR, `${slug}.json`), "utf8")) as { prompt: string };
    const key = `seed-${slug}.png`;

    const existing = await db
      .select({ id: writingTask.id })
      .from(writingTask)
      .where(eq(writingTask.imagePath, key))
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      console.log(`  = skip ${slug} (already seeded)`);
      continue;
    }

    const png = await readFile(join(DIR, `${slug}.png`));
    await uploadTask1Image(key, png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer, "image/png");

    await db.insert(writingTask).values({
      category: "academic",
      taskPart: "task1",
      imagePath: key,
      prompt: meta.prompt,
      difficulty: 2,
      bandLow: "6.0",
      bandHigh: "7.5",
      tierRequired: "ultra",
      status: "published",
    });
    seeded++;
    console.log(`  + seeded ${slug}`);
  }

  console.log(`[OK] seeded ${seeded}, skipped ${skipped} (of ${slugs.length})`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[FAIL]", e);
    process.exit(1);
  });
