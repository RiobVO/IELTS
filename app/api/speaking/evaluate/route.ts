import { NextResponse } from "next/server";
import { speakingInternalSecret } from "@/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getEvaluator } from "@/lib/speaking/evaluator";
import { isUnderlength } from "@/lib/speaking/lifecycle";
import { downloadAudio, deleteAudio } from "@/lib/speaking/storage";
import { logAudioEvent } from "@/lib/speaking/events";
import {
  claimForEvaluation, loadSubmissionForEval, persistFeedback, markFailed, markAudioDeleted,
} from "@/lib/speaking/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // audio download + Gemini audio call > default 10s

export async function POST(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), speakingInternalSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const { submissionId } = (await request.json().catch(() => ({}))) as { submissionId?: string };
  if (!submissionId) return NextResponse.json({ ok: false }, { status: 400 });

  // Idempotent claim — only the pending→evaluating winner evaluates.
  if (!(await claimForEvaluation(submissionId))) {
    return NextResponse.json({ ok: true, claimed: false }, { status: 200 });
  }

  // Biometric guards: audio already deleted = terminal (no retry); delete requested
  // mid-flight = abort without writing a transcript.
  const loaded = await loadSubmissionForEval(submissionId);
  if (!loaded.ok) {
    await markFailed(submissionId);
    return NextResponse.json({ ok: false, error: loaded.reason }, { status: 200 });
  }

  try {
    const audio = await downloadAudio(loaded.audioPath);
    await logAudioEvent(null, submissionId, "sent_to_provider");
    const result = await getEvaluator().evaluate({ audio, cueCard: loaded.cueCard });
    // Deterministic safety net: an under-minimum response always carries an underlength
    // fix, even if the model omitted one (length is the trusted server word count).
    if (isUnderlength(result.feedback.transcript)
        && !result.feedback.topFixes.some((f) => /short|longer|more/i.test(f))) {
      result.feedback.topFixes = [
        "Speak for the full 1–2 minutes — your answer was too short to show your range.",
        ...result.feedback.topFixes,
      ].slice(0, 3);
    }
    await persistFeedback(submissionId, result); // guarded: throws if reaped/delete-requested
    // Retention: drop the audio immediately on success (minimise biometric storage).
    await deleteAudio(loaded.audioPath).catch((e) => console.error("retention delete failed", submissionId, e));
    await markAudioDeleted(submissionId, null, "retention");
    return NextResponse.json({ ok: true, claimed: true }, { status: 200 });
  } catch (e) {
    console.error("speaking evaluate failed", submissionId, e);
    await markFailed(submissionId); // preview/cap NOT consumed — only 'completed' counts
    return NextResponse.json({ ok: false, error: "eval_failed" }, { status: 200 });
  }
}
