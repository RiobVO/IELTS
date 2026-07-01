import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/db";
import { answerKey, contentItem, question } from "@/db/schema";

export type PublishResult =
  | { ok: true; title: string }
  | { ok: false; reason: "not_found" | "not_reviewed" | "empty_answer_key" };

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

  // Machine hard-gate (#17): refuse to publish a test that has an empty answer key. Such a
  // question grades as always-wrong (its accept has no non-blank value → grade.ts never
  // matches), silently deflating every student's score. The parser surfaces the warning on
  // the review screen, but the human Approve could miss it — this makes the block unbypassable.
  const keys = await db
    .select({ accept: answerKey.accept })
    .from(answerKey)
    .innerJoin(question, eq(question.id, answerKey.questionId))
    .where(eq(question.contentItemId, id));
  const hasEmptyKey = keys.some((k) => {
    const acc = (k.accept as string[] | null) ?? []; // jsonb column; parser writes string[]
    return !acc.some((a) => (a ?? "").trim() !== "");
  });
  if (hasEmptyKey) return { ok: false, reason: "empty_answer_key" };

  await db.update(contentItem).set({ status: "published" }).where(eq(contentItem.id, id));
  revalidateTag("content_item");
  return { ok: true, title: row.title };
}
