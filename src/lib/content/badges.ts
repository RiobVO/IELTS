import { unstable_cache } from "next/cache";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { badge } from "@/db/schema";
import type { Criteria } from "@/lib/progress/badges";

/** Бейдж в форме, которую читают все потребители (badges/profile/result). */
export interface ActiveBadge {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  criteria: Criteria | null;
}

/**
 * Кэш PUBLIC-таблицы `badge` (~12 строк). Набор меняется только при сидинге
 * бейджей (гораздо реже, чем контент), поэтому 3 экрана (badges/profile/result)
 * не должны ходить в БД за ним на каждый визит — страницы остаются динамическими
 * под per-user данные, кэшируется только этот справочник.
 *
 * Owner (Drizzle) путь, не anon-клиент: строки публичны и читаются целиком, а
 * `unstable_cache` не должен капчурить request-scoped Supabase client (зеркалит
 * `published.ts`). Стабильный порядок по `code` — детерминизм; потребители всё
 * равно индексируют по `code`/`id`. `revalidate` — фолбэк; тег — основная,
 * немедленная инвалидация (сид-скрипт ревалидирует тег `badge`).
 */
export const getActiveBadges = unstable_cache(
  async (): Promise<ActiveBadge[]> => {
    const rows = await db
      .select({
        id: badge.id,
        code: badge.code,
        name: badge.name,
        description: badge.description,
        icon: badge.icon,
        criteria: badge.criteria,
      })
      .from(badge)
      .orderBy(asc(badge.code));
    return rows.map((r) => ({ ...r, criteria: (r.criteria as Criteria | null) ?? null }));
  },
  ["active-badges"],
  { tags: ["badge"], revalidate: 3600 },
);
