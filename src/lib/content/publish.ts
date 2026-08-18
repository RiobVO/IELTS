import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/db";
import { answerKey, contentItem, passage, question } from "@/db/schema";
import { contentTag } from "@/lib/content/exam-content";
import { isUnresolvedQuestionTypeWarning } from "@/lib/import/question-types";

export type PublishResult =
  | { ok: true; title: string }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_reviewed"
        | "unresolved_question_type"
        | "question_number_gap"
        | "answer_key_count_mismatch"
        | "empty_answer_key"
        | "missing_listening_audio"
        | "full_missing_band_scale"
        | "full_wrong_question_count";
    };

/**
 * Offset-agnostic: валидные ОДИНОЧНЫЕ пассажи нумеруются НЕ с 1 (passage_2 → 14-26,
 * passage_3 → 27-40; полный тест → 1-40). Корректный набор смежен И уникален независимо
 * от старта: нет дублей И (max-min+1) == размеру. Ловит дыры и дубли, пропускает
 * офсетные пассажи — буквальный «1..N» ложно срезал бы валидный контент.
 */
function questionNumbersOk(numbers: number[]): boolean {
  if (numbers.length === 0) return false;
  // Номера — положительные целые (Codex 2026-07-09: [-1,0,1] иначе проходит по формуле).
  if (!numbers.every((n) => Number.isInteger(n) && n > 0)) return false;
  const distinct = new Set(numbers).size;
  if (distinct !== numbers.length) return false; // дубли
  return Math.max(...numbers) - Math.min(...numbers) + 1 === distinct; // дыры
}

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
      section: contentItem.section,
      category: contentItem.category,
      bandScale: contentItem.bandScale,
    })
    .from(contentItem)
    .where(eq(contentItem.id, id))
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.reviewedAt) return { ok: false, reason: "not_reviewed" };

  // Machine hard-gate (#13, QTYPE hard-block 2026-07-11): refuse to publish a test where a
  // question type is missing OR unrecognized — both are an authoring error the client must
  // fix in the source file and re-import (docs/authoring-spec.md makes QTYPE mandatory).
  // qtype in the DB is already the short_answer fallback, so the persisted import warning is
  // the only durable trace — read it back rather than the column.
  //
  // Was softened to let an empty QTYPE through as informational (P1, 2026-07-09) while the
  // client had no authoring spec requiring it — that softening is reverted now that the spec
  // exists (BACKLOG W2-3b); see question-types.ts for the blank/unknown predicate.
  const warnings = (row.importWarnings as string[] | null) ?? [];
  if (warnings.some(isUnresolvedQuestionTypeWarning)) {
    return { ok: false, reason: "unresolved_question_type" };
  }

  // (г) Machine hard-gate (F3-min, 2026-07-12): a full test (category full_reading /
  // full_listening) must carry a band-scale table, else the result page has no percent→band
  // conversion and shows a raw percent instead of a band score (confirmed in prod). The
  // runner parser only warns on this (isFull is a heuristic, not authoritative) — the gate is
  // the actual blocker. Empty object counts as missing too (degenerate persisted value).
  const isFullCategory = (row.category ?? "").startsWith("full_");
  if (isFullCategory) {
    const scale = row.bandScale as Record<string, unknown> | null;
    if (!scale || Object.keys(scale).length === 0) {
      return { ok: false, reason: "full_missing_band_scale" };
    }
  }

  // One LEFT JOIN serves three structural gates: numbering (all questions), one key per
  // question (#б), and non-empty key (#17). An INNER JOIN would drop key-less questions
  // past gate (б), so it must be a left join from question.
  const rows = await db
    .select({ number: question.number, keyId: answerKey.id, accept: answerKey.accept })
    .from(question)
    .leftJoin(answerKey, eq(answerKey.questionId, question.id))
    .where(eq(question.contentItemId, id));

  // (а) Machine hard-gate: question numbers with no gaps and no duplicates (offset-agnostic).
  if (!questionNumbersOk(rows.map((r) => r.number))) {
    return { ok: false, reason: "question_number_gap" };
  }

  // (д) Machine hard-gate (F3-min, 2026-07-12): a full test is exactly 40 questions
  // (IELTS invariant). questionNumbersOk above is offset-agnostic on purpose (single
  // passages don't start at 1) — that same leniency lets a full test missing a head/tail
  // question (e.g. 1..39) through as a valid contiguous range. This catches it specifically
  // for full_* categories, without touching the offset-agnostic behavior for single passages.
  if (isFullCategory && rows.length !== 40) {
    return { ok: false, reason: "full_wrong_question_count" };
  }

  // (б) Machine hard-gate: every question carries an answer_key row (else grading has nothing
  // to compare against). answer_key.question_id is UNIQUE → a surplus is impossible, so this
  // only catches a missing row. Distinct from empty_answer_key (row present, accept blank).
  if (rows.some((r) => r.keyId === null)) {
    return { ok: false, reason: "answer_key_count_mismatch" };
  }

  // (#17) Machine hard-gate: no answer key is empty. An empty accept grades as always-wrong
  // (grade.ts never matches), silently deflating every student's score.
  const hasEmptyKey = rows.some((r) => {
    // jsonb column; parser writes string[] — но не-массив (напр. {}) уронил бы .some.
    const acc = Array.isArray(r.accept) ? (r.accept as string[]) : [];
    return !acc.some((a) => (a ?? "").trim() !== "");
  });
  if (hasEmptyKey) return { ok: false, reason: "empty_answer_key" };

  // (в) Machine hard-gate: a listening test must have audio before it goes live (separate
  // invariant from qtype). Read live audioPath — the mp3 may be attached as a separate file
  // AFTER import but before publish (import-runner degrades to no-audio + a warning).
  if (row.section === "listening") {
    const ps = await db
      .select({ audioPath: passage.audioPath })
      .from(passage)
      .where(eq(passage.contentItemId, id));
    if (!ps.some((p) => (p.audioPath ?? "").trim() !== "")) {
      return { ok: false, reason: "missing_listening_audio" };
    }
  }

  await db.update(contentItem).set({ status: "published" }).where(eq(contentItem.id, id));
  // Каталог (getPublishedTests, тег content_item) + per-test кэши exam/result
  // (getExamContent/getContentMeta несут content_item И content-<id>). content_item
  // сбрасывает набор каталога, content-<id> — точечно этот тест (W2-6).
  revalidateTag("content_item");
  revalidateTag(contentTag(id));
  return { ok: true, title: row.title };
}
