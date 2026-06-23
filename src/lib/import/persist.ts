import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  answerKey,
  attempt,
  contentItem,
  passage as passageT,
  question as questionT,
} from "../../db/schema";
import type { ParsedTest } from "./types";

type ContentInsert = typeof contentItem.$inferInsert;
type QuestionInsert = typeof questionT.$inferInsert;

/**
 * Повторный импорт того же файла делает DELETE content_item -> FK cascade сносит
 * passage/question/answer_key И attempt (BRIEF §5 — onDelete cascade). Если по
 * тесту уже есть попытки студентов, destructive re-import уничтожил бы их
 * историю. Бросаем — правка пройденного теста требует Re-grade (отдельный путь,
 * BRIEF §11), а не повторного импорта. Re-import draft без попыток разрешён.
 */
export class RegradeRequiredError extends Error {
  constructor(public readonly attemptCount: number) {
    super(
      `Refusing destructive re-import: the test has ${attemptCount} attempt(s) ` +
        `that a re-import would delete. Editing a sat test needs Re-grade.`,
    );
    this.name = "RegradeRequiredError";
  }
}

/**
 * Persists a ParsedTest into content_item / passage / question / answer_key in
 * one transaction (server-side, service-role — answer_key writes need it).
 * Idempotent per sourceFilePath: re-importing the same file replaces the prior
 * rows (cascade). Content starts as `draft` (BRIEF §4.2.1 — admin confirms key
 * before publishing).
 */
export async function persistTest(
  parsed: ParsedTest,
  opts: { sourceFilePath?: string; createdBy?: string; runnerHtml?: string } = {},
): Promise<string> {
  return db.transaction(async (tx) => {
    if (opts.sourceFilePath) {
      // Guard: не уничтожать историю попыток. Если прежняя версия теста уже
      // проходилась, отказываем в destructive re-import (см. RegradeRequiredError).
      const existing = await tx
        .select({ id: contentItem.id })
        .from(contentItem)
        .where(eq(contentItem.sourceFilePath, opts.sourceFilePath));
      if (existing.length > 0) {
        const [row] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(attempt)
          .where(
            inArray(
              attempt.contentItemId,
              existing.map((r) => r.id),
            ),
          );
        const n = row?.n ?? 0;
        if (n > 0) throw new RegradeRequiredError(n);
      }
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
        // Full mock tests (Reading/Listening) are a Premium feature; single
        // passages/parts stay Basic. Gating at the source means the catalog lock
        // (meetsTier) and the server tier-gates apply to every new import without
        // a manual step. Already-imported tests are backfilled separately.
        tierRequired:
          parsed.category === "full_reading" || parsed.category === "full_listening"
            ? "premium"
            : "basic",
        bandType: parsed.bandType as ContentInsert["bandType"],
        questionTypes: parsed.questionTypes,
        bandScale: parsed.bandScale, // raw->band table for Full tests; null otherwise
        runnerHtml: opts.runnerHtml ?? null,
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
          questionsHtml: p.questionsHtml ?? null,
        })
        .returning({ id: passageT.id });
      passageIdByOrder.set(p.order, row!.id);
    }
    // Map each question to its passage/part via passageOrder (Listening: 4 parts;
    // single Reading: order 1). Falls back to the first passage if the order is
    // somehow missing, so a question is never orphaned.
    const fallbackPassageId =
      passageIdByOrder.get(1) ?? [...passageIdByOrder.values()][0]!;

    for (const q of parsed.questions) {
      const [qrow] = await tx
        .insert(questionT)
        .values({
          contentItemId,
          passageId: passageIdByOrder.get(q.passageOrder) ?? fallbackPassageId,
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
