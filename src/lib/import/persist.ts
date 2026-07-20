import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  answerKey,
  contentItem,
  passage as passageT,
  question as questionT,
} from "../../db/schema";
import type { ParsedTest } from "./types";

type ContentInsert = typeof contentItem.$inferInsert;
type QuestionInsert = typeof questionT.$inferInsert;

/**
 * Persists a ParsedTest into content_item / passage / question / answer_key in
 * one transaction (server-side, service-role — answer_key writes need it).
 * Idempotent per sourceFilePath: re-importing the same file replaces the prior
 * rows (cascade). Content starts as `draft` (BRIEF §4.2.1 — admin confirms key
 * before publishing).
 */
export async function persistTest(
  parsed: ParsedTest,
  opts: { sourceFilePath?: string; createdBy?: string } = {},
): Promise<string> {
  return db.transaction(async (tx) => {
    if (opts.sourceFilePath) {
      await tx
        .delete(contentItem)
        .where(eq(contentItem.sourceFilePath, opts.sourceFilePath));
    }

    const [ci] = await tx
      .insert(contentItem)
      .values({
        section: parsed.section,
        category: parsed.category as ContentInsert["category"],
        title: parsed.title,
        sourceFilePath: opts.sourceFilePath ?? null,
        durationSeconds: parsed.durationSeconds,
        tierRequired: "basic",
        bandType: parsed.bandType as ContentInsert["bandType"],
        questionTypes: parsed.questionTypes,
        status: "draft",
        createdBy: opts.createdBy ?? null,
      })
      .returning({ id: contentItem.id });

    const contentItemId = ci!.id;

    // Insert passages; map order -> id. Single-passage tests use order 1.
    const passageIdByOrder = new Map<number, string>();
    for (const p of parsed.passages) {
      const [row] = await tx
        .insert(passageT)
        .values({
          contentItemId,
          order: p.order,
          title: p.title,
          bodyHtml: p.bodyHtml,
          audioPath: p.audioPath,
        })
        .returning({ id: passageT.id });
      passageIdByOrder.set(p.order, row!.id);
    }
    // TODO(full-tests): map each question to its section's passage. Single
    // passage/part tests (this template) have exactly one.
    const defaultPassageId = passageIdByOrder.get(1) ?? [...passageIdByOrder.values()][0]!;

    for (const q of parsed.questions) {
      const [qrow] = await tx
        .insert(questionT)
        .values({
          contentItemId,
          passageId: defaultPassageId,
          number: q.number,
          qtype: q.qtype as QuestionInsert["qtype"],
          promptHtml: q.promptHtml,
          options: q.options,
          groupKey: q.groupKey,
          evidenceRef: q.evidenceRef,
          order: q.number,
        })
        .returning({ id: questionT.id });

      await tx.insert(answerKey).values({
        questionId: qrow!.id,
        mode: q.answer.mode,
        accept: q.answer.accept,
        explanation: q.answer.explanation,
        evidence: q.answer.evidence,
      });
    }

    return contentItemId;
  });
}
