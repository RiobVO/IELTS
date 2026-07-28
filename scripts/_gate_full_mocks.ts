/**
 * Throwaway-бэкфилл: проставляет tier_required='premium' уже залитым full-mock
 * тестам (category full_reading / full_listening). Нужен потому, что гейтинг в
 * src/lib/import/persist.ts применяется только к БУДУЩИМ импортам — существующие
 * строки остались tier_required='basic' и каталог их не залочит без этого шага.
 *
 * Single passages/parts НЕ трогаются — Premium-фича только полные mock-тесты.
 * Идемпотентно: обновляет лишь строки, где tier_required ещё не 'premium'.
 *
 * Безопасность: пишет owner-путём (обходит RLS), поэтому dry-run по умолчанию —
 * без --apply скрипт только показывает план и ничего не пишет. Это операторский
 * шаг против прод-Supabase, здесь НЕ автоматизирован.
 *
 * Запуск (ОПЕРАТОР):
 *   npx tsx scripts/_gate_full_mocks.ts            # dry-run: показать план
 *   npx tsx scripts/_gate_full_mocks.ts --apply    # записать premium
 * DIRECT_URL (или DATABASE_URL) берётся из .env.local — owner-подключение как в
 * migrate.ts.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { and, inArray, ne } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contentItem } from "../src/db/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
config({ path: join(HERE, "..", ".env.local") });

/** Категории, которые становятся Premium. Single passages/parts остаются Basic. */
const FULL_CATEGORIES = ["full_reading", "full_listening"] as const;

type Db = PostgresJsDatabase<{ contentItem: typeof contentItem }>;

async function main(): Promise<boolean> {
  const apply = process.argv.includes("--apply");

  const dbUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.trim() === "") {
    console.log("[FAIL] missing env: DIRECT_URL (or DATABASE_URL)");
    return false;
  }

  const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => {} });
  const db: Db = drizzle(sql, { schema: { contentItem } });

  try {
    // Все full-mock тесты — для плана/контекста оператору.
    const all = await db
      .select({
        id: contentItem.id,
        title: contentItem.title,
        category: contentItem.category,
        tierRequired: contentItem.tierRequired,
        status: contentItem.status,
      })
      .from(contentItem)
      .where(inArray(contentItem.category, [...FULL_CATEGORIES]))
      .orderBy(contentItem.category, contentItem.title);

    if (all.length === 0) {
      console.log("[OK] no full_reading/full_listening tests found — nothing to gate.");
      return true;
    }

    const alreadyPremium = all.filter((r) => r.tierRequired === "premium");
    const toGate = all.filter((r) => r.tierRequired !== "premium");

    console.error(`Found ${all.length} full-mock test(s):`);
    for (const r of all) {
      const mark = r.tierRequired === "premium" ? "premium (skip)" : `${r.tierRequired} -> premium`;
      console.error(`  · [${r.category}] ${r.title} (${r.status}) — ${mark}`);
    }
    console.error("");

    if (!apply) {
      console.log(
        `[OK] dry-run: ${toGate.length} test(s) would be set to premium ` +
          `(${alreadyPremium.length} already premium). Re-run with --apply to write.`,
      );
      return true;
    }

    if (toGate.length === 0) {
      console.log(`[OK] nothing to do — all ${all.length} full-mock test(s) already premium.`);
      return true;
    }

    const updated = await db
      .update(contentItem)
      .set({ tierRequired: "premium" })
      .where(
        and(
          inArray(contentItem.category, [...FULL_CATEGORIES]),
          ne(contentItem.tierRequired, "premium"),
        ),
      )
      .returning({ id: contentItem.id });

    console.log(
      `[OK] ${updated.length} test(s) set to premium ` +
        `(${alreadyPremium.length} already premium).`,
    );
    return true;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((e) => {
    console.log(`[FAIL] ${e instanceof Error ? e.message : String(e)}`);
    console.error(e);
    process.exit(1);
  });
