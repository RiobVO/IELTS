import { NextResponse } from "next/server";
import { writingInternalSecret } from "@/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getEvaluator } from "@/lib/writing/evaluator";
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
    const input = await loadSubmissionForEval(submissionId);
    if (!input) {
      await markFailed(submissionId);
      return NextResponse.json({ ok: false, error: "submission_gone" }, { status: 200 });
    }
    const result = await getEvaluator().evaluate(input);
    // Deterministic safety net: a sub-250-word essay always carries an underlength
    // warning, even if the model omitted one (length is the trusted server count).
    const feedback = withUnderlengthFlag(result.feedback, input.wordCount);
    await persistFeedback(submissionId, { ...result, feedback });
    return NextResponse.json({ ok: true, claimed: true }, { status: 200 });
  } catch (e) {
    console.error("writing evaluate failed", submissionId, e);
    await markFailed(submissionId); // preview/cap NOT consumed — only 'completed' counts
    return NextResponse.json({ ok: false, error: "eval_failed" }, { status: 200 });
  }
}
