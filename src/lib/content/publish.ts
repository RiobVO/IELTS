import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/db";
import { contentItem } from "@/db/schema";

export type PublishResult =
  | { ok: true; title: string }
  | { ok: false; reason: "not_found" | "not_reviewed" };

/**
 * Publish a content item — ONLY if its answer key has been reviewed (reviewed_at set,
 * BRIEF §4.2.1). This is the single chokepoint every publish path must go through (the
 * admin UI and the Telegram bot), so the review gate can't be bypassed by reaching one
 * path directly. Owner-path (RLS-bypassing) — the caller is the trust boundary.
 * Revalidates the catalog cache tag on a successful publish.
 */
export async function publishReviewedContentItem(id: string): Promise<PublishResult> {
  const [row] = await db
    .select({ reviewedAt: contentItem.reviewedAt, title: contentItem.title })
    .from(contentItem)
    .where(eq(contentItem.id, id))
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.reviewedAt) return { ok: false, reason: "not_reviewed" };

  await db.update(contentItem).set({ status: "published" }).where(eq(contentItem.id, id));
  revalidateTag("content_item");
  return { ok: true, title: row.title };
}
