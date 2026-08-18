import { unstable_cache } from "next/cache";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentItem, question } from "@/db/schema";

/**
 * Cached list of PUBLISHED tests for a section (BRIEF §4.1 catalog). The set only
 * changes when an admin publishes/unpublishes (admin actions revalidate the
 * "content_item" tag), so the catalog needn't hit content_item on every visit —
 * the page itself stays dynamic for per-user auth/tier, only this data is cached.
 *
 * Owner (Drizzle) path, not the anon client: published rows are public anyway and
 * the keys returned are public columns only (never answer_key), and unstable_cache
 * must not capture a request-scoped client. Ordered newest-first so callers can
 * filter in memory without re-sorting. `revalidate` is a fallback; the tag is the
 * primary, immediate invalidation.
 */
export const getPublishedTests = unstable_cache(
  async (section: "reading" | "listening") => {
    // items (список секции) и counts (Q-count на тест, grouped) независимы — на
    // cold-start (промах кэша) читаем их одним параллельным слоем, не последовательно.
    // counts кэшируется вместе со списком и инвалидируется тем же тегом content_item.
    const [items, counts] = await Promise.all([
      db
        .select({
          id: contentItem.id,
          title: contentItem.title,
          category: contentItem.category,
          question_types: contentItem.questionTypes,
          duration_seconds: contentItem.durationSeconds,
          tier_required: contentItem.tierRequired,
          // Флаг наличия очищенного раннера (iframe-обёртка) — НЕ тащим сам text
          // (~200КБ/тест) в кэш каталога; каталог только маршрутизирует по нему.
          has_runner: sql<boolean>`${contentItem.runnerHtml} IS NOT NULL`,
          // Для бейджа «New» (F15) — сам расчёт «свежести» относительно now() в кэш
          // не кладём (unstable_cache переживёт TTL/revalidate), считает вызывающая
          // страница вне кэша.
          created_at: contentItem.createdAt,
        })
        .from(contentItem)
        .where(
          and(eq(contentItem.section, section), eq(contentItem.status, "published")),
        )
        .orderBy(desc(contentItem.createdAt)),
      db
        .select({ cid: question.contentItemId, n: sql<number>`count(*)::int` })
        .from(question)
        .groupBy(question.contentItemId),
    ]);
    if (items.length === 0) return [];

    const byId = new Map(counts.map((c) => [c.cid, Number(c.n) || 0]));
    // created_at → ISO-строка ДО возврата: на cache HIT unstable_cache гоняет
    // результат через JSON.stringify/parse, и Date всё равно пришёл бы строкой —
    // Drizzle-тип Date маскировал бы это на MISS. Сериализуем сами, тип честный.
    return items.map((it) => ({
      ...it,
      created_at: it.created_at.toISOString(),
      question_count: byId.get(it.id) ?? 0,
    }));
  },
  ["published-tests"],
  { tags: ["content_item"], revalidate: 300 },
);
