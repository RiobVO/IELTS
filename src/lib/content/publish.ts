import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/db";
import { answerKey, contentItem, question } from "@/db/schema";
import { contentTag } from "@/lib/content/exam-content";
import { isUnknownTypeWarning } from "@/lib/import/question-types";

export type PublishResult =
  | { ok: true; title: string }
  | {
      ok: false;
      reason: "not_found" | "not_reviewed" | "empty_answer_key" | "unresolved_question_type";
    };

/**
 * Publish a content item — ONLY if its answer key has been reviewed (reviewed_at set,
 * BRIEF §4.2.1). This is the single chokepoint every publish path must go through (the
 * admin UI and the Telegram bot), so the review gate can't be bypassed by reaching one
 * path directly. Owner-path (RLS-bypassing) — the caller is the trust boundary.
 * Revalidates the catalog cache tag on a successful publish.
 */
export async function publishReviewedContentItem(id: string): Promise<PublishResult> {
  const [row] = await db
    .select({
      reviewedAt: contentItem.reviewedAt,
      title: contentItem.title,
      importWarnings: contentItem.importWarnings,
    })
    .from(contentItem)
    .where(eq(contentItem.id, id))
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.reviewedAt) return { ok: false, reason: "not_reviewed" };

  // Machine hard-gate (#13): refuse to publish a test where a question's source label
  // mapped to no canon type (parser fell back to short_answer). qtype in the DB is already
  // the fallback value, so the persisted import warning is the only durable trace — read it
  // back rather than the column. Only the unknown-type class blocks; low-confidence /
  // no-explanation warnings are informational and must not bar a valid import.
  const warnings = (row.importWarnings as string[] | null) ?? [];
  if (warnings.some(isUnknownTypeWarning)) {
    return { ok: false, reason: "unresolved_question_type" };
  }

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
  // Каталог (getPublishedTests, тег content_item) + per-test кэши exam/result
  // (getExamContent/getContentMeta несут content_item И content-<id>). content_item
  // сбрасывает набор каталога, content-<id> — точечно этот тест (W2-6).
  revalidateTag("content_item");
  revalidateTag(contentTag(id));
  return { ok: true, title: row.title };
}
