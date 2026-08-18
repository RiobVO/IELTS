import { NextResponse } from "next/server";
import { writingInternalSecret } from "@/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logError } from "@/lib/monitoring/log-error";
import { getEvaluator } from "@/lib/writing/evaluator";
import { minWordsFor } from "@/lib/writing/lifecycle";
import { downloadTask1Image } from "@/lib/writing/storage";
import { withUnderlengthFlag } from "@/lib/writing/underlength";
import {
  claimForEvaluation,
  loadSubmissionForEval,
  persistFeedback,
  markFailed,
} from "@/lib/writing/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), writingInternalSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const { submissionId } = (await request.json().catch(() => ({}))) as { submissionId?: string };
  if (!submissionId) return NextResponse.json({ ok: false }, { status: 400 });

  // Idempotent: only the pending→evaluating claim winner evaluates. A re-fire
  // (lost-trigger re-kick / reaper) loses the claim → 200 no-op, never a duplicate.
  if (!(await claimForEvaluation(submissionId))) {
    return NextResponse.json({ ok: true, claimed: false }, { status: 200 });
  }

  try {
    const sub = await loadSubmissionForEval(submissionId);
    if (!sub) {
      await markFailed(submissionId);
      return NextResponse.json({ ok: false, error: "submission_gone" }, { status: 200 });
    }
    // Task 1 is graded against its visual: download the chart owner-path (service-role,
    // server-only) and hand it to the evaluator as pre-loaded bytes. Task 2 sends none.
    const image =
      sub.taskPart === "task1" && sub.imagePath ? await downloadTask1Image(sub.imagePath) : undefined;
    const result = await getEvaluator().evaluate({
      essay: sub.essay,
      taskPrompt: sub.taskPrompt,
      category: sub.category,
      taskPart: sub.taskPart,
      wordCount: sub.wordCount,
      image,
    });
    // Deterministic safety net: an under-minimum response always carries an underlength
    // warning, even if the model omitted one (length is the trusted server count). The
    // floor is part-specific — 150 for Task 1, 250 for Task 2.
    const feedback = withUnderlengthFlag(result.feedback, sub.wordCount, minWordsFor(sub.taskPart));
    await persistFeedback(submissionId, { ...result, feedback });
    return NextResponse.json({ ok: true, claimed: true }, { status: 200 });
  } catch (e) {
    await logError({
      source: "server",
      message: "writing evaluate failed",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "writingEvaluate", submissionId },
    });
    await markFailed(submissionId); // preview/cap NOT consumed — only 'completed' counts
    return NextResponse.json({ ok: false, error: "eval_failed" }, { status: 200 });
  }
}
