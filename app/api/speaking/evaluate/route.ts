import { NextResponse } from "next/server";
import { speakingInternalSecret } from "@/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logError } from "@/lib/monitoring/log-error";
import { getEvaluator } from "@/lib/speaking/evaluator";
import { isUnderlength } from "@/lib/speaking/lifecycle";
import { downloadAudio } from "@/lib/speaking/storage";
import { transcribeTimings } from "@/lib/speaking/stt";
import { alignTranscriptTimings, type TranscriptTiming } from "@/lib/speaking/transcript-align";
import { logAudioEvent } from "@/lib/speaking/events";
import {
  claimForEvaluation, loadSubmissionForEval, persistFeedback, markFailed,
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
    // Karaoke-sync timings (#3): borrow Whisper's accurate word clocks and align them onto
    // the Gemini verbatim transcript by sentence. Strictly optional — STT unconfigured or a
    // transport error must NEVER fail the eval, so it degrades to [] (static transcript).
    let timings: TranscriptTiming[] = [];
    try {
      const stt = await transcribeTimings(Buffer.from(audio.data, "base64"), audio.mimeType);
      if (stt) timings = alignTranscriptTimings(result.feedback.transcript, stt.words, stt.duration);
    } catch (e) {
      await logError({
        source: "server",
        message: "speaking timings failed (non-fatal)",
        stack: e instanceof Error ? e.stack : null,
        context: { op: "speakingTimings", submissionId },
      });
    }
    await persistFeedback(submissionId, result, timings); // guarded: throws if reaped/delete-requested
    // Audio is KEPT after a successful eval so the user can replay their take and work
    // on it. Cleanup is the 7-day retention reaper (cron) or an explicit user delete —
    // not an immediate drop here. Privacy: still a private bucket + consent + auto-expiry.
    return NextResponse.json({ ok: true, claimed: true }, { status: 200 });
  } catch (e) {
    await logError({
      source: "server",
      message: "speaking evaluate failed",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "speakingEvaluate", submissionId },
    });
    await markFailed(submissionId); // preview/cap NOT consumed — only 'completed' counts
    return NextResponse.json({ ok: false, error: "eval_failed" }, { status: 200 });
  }
}
