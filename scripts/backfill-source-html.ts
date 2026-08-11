/**
 * Backfill: заливает исходный (необрезанный) HTML уже импортированных published
 * тестов в приватный Storage bucket `source-html` — закрывает дыру воспроизводимости
 * для тестов, импортированных ДО того, как importRunner стал делать это сам
 * (см. src/lib/import/runner/import-runner.ts, шаг 4).
 *
 * Маппинг файл -> content_item: тот же resolveSourceFile, что resolveSource в S1-спайке
 * (scripts/_spike_atomize.ts) — sourceFilePath это либо голое имя из Telegram, либо
 * локальный абсолютный путь CLI-импорта; пробуем буквальный путь, затем известные
 * локальные зеркала по basename (.qa-import\, ~/Downloads\, ~/Downloads/Telegram Desktop\).
 *
 * Идемпотентно (uploadSourceHtml — upsert). БД не трогает, ничего не пишет — только
 * Storage. `--dry` печатает план и ничего не заливает.
 *
 *   npx tsx scripts/backfill-source-html.ts --dry
 *   npx tsx scripts/backfill-source-html.ts
 */
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { realpathSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const QA_IMPORT = join(HERE, "..", ".qa-import");
const DOWNLOADS = join(homedir(), "Downloads");
const TG_DESKTOP = join(DOWNLOADS, "Telegram Desktop");

/**
 * Совпадает с resolveSource в scripts/_spike_atomize.ts — тот же набор кандидатов и
 * порядок приоритета. Чистая логика (кроме existsSync-проверки против диска),
 * вынесена сюда для юнит-теста маппинга.
 */
export function resolveSourceFile(sourceFilePath: string | null): string | null {
  if (!sourceFilePath) return null;
  const name = basename(sourceFilePath);
  const candidates = [sourceFilePath, join(QA_IMPORT, name), join(DOWNLOADS, name), join(TG_DESKTOP, name)];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/* --------------------------------- CLI ----------------------------------- */
const invokedDirectly =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const { readFileSync } = await import("node:fs");
  const { config } = await import("dotenv");
  config({ path: join(HERE, "..", ".env.local") });

  const dry = process.argv.includes("--dry");

  const { db } = await import("../src/db/index.ts");
  const { sql } = await import("drizzle-orm");
  const { uploadSourceHtml } = await import("../src/lib/import/source-html-storage.ts");

  interface DbRow {
    id: string;
    title: string;
    source_file_path: string | null;
  }

  const rows = (await db.execute(sql`
    SELECT id, title, source_file_path
    FROM content_item
    WHERE status = 'published'
    ORDER BY title
  `)) as unknown as DbRow[];

  let uploaded = 0;
  const missing: { id: string; title: string; sourceFilePath: string | null }[] = [];

  for (const row of rows) {
    const resolved = resolveSourceFile(row.source_file_path);
    if (!resolved) {
      missing.push({ id: row.id, title: row.title, sourceFilePath: row.source_file_path });
      continue;
    }
    console.log(`${dry ? "[dry] would upload" : "uploading"} ${row.id} "${row.title}" <- ${resolved}`);
    if (!dry) {
      try {
        const html = readFileSync(resolved, "utf8");
        await uploadSourceHtml(row.id, html);
      } catch (e) {
        console.error(`  FAILED for ${row.id}:`, e);
        missing.push({ id: row.id, title: row.title, sourceFilePath: row.source_file_path });
        continue;
      }
    }
    uploaded++;
  }

  console.log(`\n--- summary ---`);
  console.log(`published content_item: ${rows.length}`);
  console.log(`${dry ? "would upload" : "uploaded"}: ${uploaded}`);
  console.log(`no local source found (skipped): ${missing.length}`);
  for (const m of missing) {
    console.log(`  ${m.id} "${m.title}" — source_file_path: ${m.sourceFilePath ?? "(null)"}`);
  }

  process.exit(0);
}
