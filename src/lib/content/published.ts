import { unstable_cache } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contentItem } from "@/db/schema";

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
  async (section: "reading" | "listening") =>
    db
      .select({
        id: contentItem.id,
        title: contentItem.title,
        category: contentItem.category,
        question_types: contentItem.questionTypes,
        duration_seconds: contentItem.durationSeconds,
        tier_required: contentItem.tierRequired,
      })
      .from(contentItem)
      .where(
        and(eq(contentItem.section, section), eq(contentItem.status, "published")),
      )
      .orderBy(desc(contentItem.createdAt)),
  ["published-tests"],
  { tags: ["content_item"], revalidate: 300 },
);
