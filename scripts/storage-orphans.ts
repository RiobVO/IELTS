/**
 * CLI: инвентаризация и (по флагу) удаление объектов-сирот в Storage-бакетах
 * `audio` и `source-html`. Сирота = объект, чьего content_item больше нет в БД
 * (контент-вайп 2026-07-10 оставил старые mp3/html без строк; Storage Free = 1 GB).
 * Бакеты `speaking-audio` / `writing-task1` НЕ трогаются — вне списка BUCKETS.
 *
 * Порядок операций критичен: СНАЧАЛА полный листинг объектов, ПОТОМ чтение живых
 * ключей из БД. Объект, залитый параллельным импортом ПОСЛЕ нашего листинга, в
 * выборку не попадёт и не будет ошибочно удалён. Но в runner-импорте аудио
 * заливается ДО создания строки content_item (import-runner.ts: upload → persist),
 * поэтому листинг может захватить объект импорта, идущего прямо сейчас, у которого
 * строки ещё нет. Это окно закрывает grace-период: объекты моложе RECENT_GRACE_MS
 * никогда не считаются сиротами (состояние `recent`) — живой импорт длится секунды,
 * час перекрывает его с запасом.
 *
 * Свой клиент из env (dotenv), server-only из app-графа не тащим.
 *   npx tsx scripts/storage-orphans.ts            # dry-run (только печать)
 *   npx tsx scripts/storage-orphans.ts --delete   # удалить сирот
 *   npx tsx scripts/storage-orphans.ts --help
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BUCKETS = ["audio", "source-html"] as const;
type Bucket = (typeof BUCKETS)[number];
/** Детерминированное расширение ключа по бакету (см. storage.ts / source-html-storage.ts). */
const EXT: Record<Bucket, string> = { audio: ".mp3", "source-html": ".html" };
const LIST_PAGE = 1000; // размер страницы storage.list (default 100 — мало)
const DELETE_BATCH = 100; // storage.remove батчами ≤100
// Объекты моложе часа не трогаем: runner-импорт заливает аудио ДО persist строки,
// без grace-окна конкурентный --delete мог бы удалить аудио живого импорта.
const RECENT_GRACE_MS = 60 * 60 * 1000;

interface StorageObject {
  bucket: Bucket;
  name: string;
  size: number;
  createdAt: string | null;
}

/**
 * Объект ЖИВ, если его имя = `${liveId}${ext}` для существующего content_item.id
 * ИЛИ входит подстрокой в какой-либо passage.audio_path (страховка: audio_path
 * хранит публичный URL с ключом). Иначе — сирота.
 */
export function isOrphan(
  o: StorageObject,
  liveIds: Set<string>,
  audioPaths: string[],
): boolean {
  const ext = EXT[o.bucket];
  const idPart = o.name.endsWith(ext) ? o.name.slice(0, -ext.length) : o.name;
  if (liveIds.has(idPart)) return false;
  if (audioPaths.some((p) => p.includes(o.name))) return false;
  return true;
}

const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

const USAGE =
  "scripts/storage-orphans.ts — инвентарь/чистка сирот в бакетах audio, source-html\n" +
  "  npx tsx scripts/storage-orphans.ts            dry-run (печать таблицы + итоги)\n" +
  "  npx tsx scripts/storage-orphans.ts --delete   удалить сирот (батчами ≤100)\n" +
  "  npx tsx scripts/storage-orphans.ts --help     эта справка";

async function main(): Promise<number> {
  if (process.argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }

  const { config } = await import("dotenv");
  config({ path: ".env.local" });
  const { createClient } = await import("@supabase/supabase-js");
  const postgres = (await import("postgres")).default;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dbUrl = process.env.DATABASE_URL;
  if (!url || !svcKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY отсутствуют в .env.local");
  if (!dbUrl) throw new Error("DATABASE_URL отсутствует в .env.local");

  const doDelete = process.argv.includes("--delete");
  const supabase = createClient(url, svcKey, { auth: { persistSession: false } });
  const sql = postgres(dbUrl, { prepare: false, max: 1 });

  try {
    // 1) СНАЧАЛА полный листинг объектов (пагинация — default limit=100).
    const objects: StorageObject[] = [];
    for (const bucket of BUCKETS) {
      for (let offset = 0; ; offset += LIST_PAGE) {
        const { data, error } = await supabase.storage.from(bucket).list("", {
          limit: LIST_PAGE,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
        if (error) throw new Error(`list ${bucket} failed: ${error.message}`);
        if (!data || data.length === 0) break;
        for (const f of data) {
          // Псевдо-папки приходят с id=null и без metadata — в плоских бакетах их нет,
          // но пропускаем на всякий случай (это префикс, не объект).
          if (f.id === null) continue;
          objects.push({
            bucket,
            name: f.name,
            size: Number(f.metadata?.size ?? 0),
            createdAt: f.created_at ?? null,
          });
        }
        if (data.length < LIST_PAGE) break;
      }
    }

    // 2) ПОТОМ живые ключи из БД (порядок важен — см. шапку файла).
    const idRows = await sql<{ id: string }[]>`SELECT id FROM content_item`;
    const liveIds = new Set(idRows.map((r) => r.id));
    const pathRows = await sql<{ audio_path: string }[]>`
      SELECT audio_path FROM passage WHERE audio_path IS NOT NULL AND audio_path <> ''`;
    const audioPaths = pathRows.map((r) => r.audio_path);

    // 3) Классификация + печать таблицы. `recent` (моложе grace-окна) — не сирота:
    //    возможно, это аудио импорта, идущего прямо сейчас (строка ещё не создана).
    const now = Date.now();
    const classified = objects.map((o) => {
      // Fail-closed: null/невалидный created_at считаем «свежим» — деструктивный
      // тул не имеет права удалять объект, возраст которого не смог установить.
      const age = o.createdAt === null ? NaN : now - Date.parse(o.createdAt);
      const recent = Number.isNaN(age) || age < RECENT_GRACE_MS;
      return { o, state: recent ? "recent" : isOrphan(o, liveIds, audioPaths) ? "ORPHAN" : "live" };
    });
    const orphans = classified.filter((c) => c.state === "ORPHAN").map((c) => c.o);
    const liveCount = classified.length - orphans.length;
    const freeBytes = orphans.reduce((s, o) => s + o.size, 0);

    console.log(`bucket        state   ${"size".padStart(7)}      key`);
    for (const { o, state } of classified) {
      console.log(
        `${o.bucket.padEnd(12)}  ${state.padEnd(6)}  ${mb(o.size).padStart(7)} MB  ${o.name}`,
      );
    }
    console.log(
      `\n${orphans.length} orphans, ${mb(freeBytes)} MB to free / ${liveCount} live+recent` +
        ` (${classified.length} objects, ${liveIds.size} live content_item)`,
    );

    if (!doDelete) {
      console.log("\n(dry-run) добавь --delete, чтобы удалить сирот.");
      return 0;
    }
    if (orphans.length === 0) {
      console.log("[OK] deleted 0 objects, freed 0.0 MB (сирот нет)");
      return 0;
    }

    // 4) Удаление ТОЛЬКО сирот, батчами ≤100, отдельно по каждому бакету.
    let deleted = 0;
    for (const bucket of BUCKETS) {
      const names = orphans.filter((o) => o.bucket === bucket).map((o) => o.name);
      for (let i = 0; i < names.length; i += DELETE_BATCH) {
        const batch = names.slice(i, i + DELETE_BATCH);
        const { error } = await supabase.storage.from(bucket).remove(batch);
        if (error) {
          console.error(`[FAIL] remove ${bucket} batch (${batch.length}): ${error.message}`);
          return 1;
        }
        deleted += batch.length;
      }
    }
    console.log(`[OK] deleted ${deleted} objects, freed ${mb(freeBytes)} MB`);
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const invokedDirectly =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error("[FAIL]", e);
      process.exit(1);
    });
}
