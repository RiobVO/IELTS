"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { answerKey, attempt, question } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { grade, type GradeKey } from "@/lib/grading/grade";

/**
 * Submit an attempt. Grading is server-only (BRIEF §4.6 anti-cheat): the client
 * sends just its answers; the server reads the answer key (owner role, bypasses
 * RLS), scores, and persists. No score ever comes from the client.
 */
export async function submitAttempt(
  contentItemId: string,
  answers: Record<string, string | string[]>,
  timeUsedSeconds: number,
) {
  const user = await getUser();
  if (!user) redirect("/auth");

  const rows = await db
    .select({
      number: question.number,
      qtype: question.qtype,
      mode: answerKey.mode,
      accept: answerKey.accept,
    })
    .from(question)
    .innerJoin(answerKey, eq(answerKey.questionId, question.id))
    .where(eq(question.contentItemId, contentItemId));

  if (rows.length === 0) redirect(`/app/reading/${contentItemId}`);

  const keys: GradeKey[] = rows.map((r) => ({
    number: r.number,
    qtype: r.qtype,
    mode: r.mode,
    accept: (r.accept as string[]) ?? [],
  }));

  const result = grade(keys, answers);

  // band is only meaningful for Full (40-question) tests (BRIEF §11); single
  // passage/part -> percent only, band_score null.
  const [row] = await db
    .insert(attempt)
    .values({
      userId: user.id,
      contentItemId,
      mode: "practice",
      status: "submitted",
      answers,
      startedAt: new Date(Date.now() - timeUsedSeconds * 1000),
      submittedAt: new Date(),
      timeUsedSeconds,
      rawScore: result.rawScore,
      bandScore: null,
      perTypeBreakdown: result.perType,
    })
    .returning({ id: attempt.id });

  redirect(`/app/reading/${contentItemId}/result?a=${row!.id}`);
}
