/**
 * Создаёт (идемпотентно) public-bucket `writing-task1` под визуалы Task 1.
 * Bucket — Storage-примитив, не часть SQL-миграций, поэтому отдельный one-shot
 * скрипт через service-role. Публичный read безопасен: картинка это условие
 * задания, не секрет (см. src/lib/writing/storage.ts).
 *
 * Запуск:  npx tsx scripts/setup-task1-bucket.ts
 *
 * dotenv + клиент импортируются динамически ПОСЛЕ загрузки env (src/env.ts
 * валидирует переменные при импорте — см. CLAUDE.md «Scripts gotcha»).
 */
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

async function main() {
  const { config } = await import("dotenv");
  config({ path: join(HERE, "..", ".env.local") });
  const { createServiceClient } = await import("@/lib/supabase/service");
  const { TASK1_BUCKET, TASK1_IMAGE_MIME } = await import("@/lib/writing/storage");

  const supabase = createServiceClient();
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw listErr;

  if (buckets?.some((b) => b.name === TASK1_BUCKET)) {
    console.log(`[OK] bucket "${TASK1_BUCKET}" already exists — no-op`);
    return;
  }

  const { error } = await supabase.storage.createBucket(TASK1_BUCKET, {
    public: true,
    allowedMimeTypes: [...TASK1_IMAGE_MIME],
    fileSizeLimit: "3MB",
  });
  if (error) throw error;
  console.log(`[OK] created public bucket "${TASK1_BUCKET}"`);
}

const invokedDirectly =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((e) => {
    console.error("[FAIL]", e);
    process.exit(1);
  });
}
