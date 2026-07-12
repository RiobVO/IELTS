import { NextResponse } from "next/server";
import { and, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { speakingSubmission } from "@/db/schema";
import { isCronAuthorized } from "@/lib/cron-auth";
import { cronSecret } from "@/env";
import { logError } from "@/lib/monitoring/log-error";
import { deleteAudio } from "@/lib/speaking/storage";
import { markAudioDeleted, markAudioDeleteFailed } from "@/lib/speaking/store";

export const dynamic = "force-dynamic";
const STALE_MS = Number(process.env.SPEAKING_STALE_MS ?? 120000);
const RETENTION_DAYS = Number(process.env.SPEAKING_AUDIO_RETENTION_DAYS ?? 7);

export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), cronSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const now = Date.now();
    const staleBefore = new Date(now - STALE_MS);
    const retentionBefore = new Date(now - RETENTION_DAYS * 86400000);

    // (1) Fail rows stuck in a transient state past the window (frees the one-active slot).
    const stuck = await db.update(speakingSubmission)
      .set({ status: "failed", updatedAt: new Date() })
      .where(and(
        inArray(speakingSubmission.status, ["uploading", "pending", "evaluating"]),
        lt(speakingSubmission.updatedAt, staleBefore),
      ))
      .returning({
        id: speakingSubmission.id, audioPath: speakingSubmission.audioPath,
        userId: speakingSubmission.userId, deleteRequestedAt: speakingSubmission.deleteRequestedAt,
      });

    // (2) Delete orphan/retention audio: rows whose audio still exists but is either
    // just-failed-stuck above, or completed older than retention (defensive — eval
    // already deletes on success), or a stale 'uploading' orphan object.
    // N5: провалившийся явный delete (delete_requested_at установлен) и любой
    // зафиксированный сбой remove (audio_delete_error) чистятся СЛЕДУЮЩИМ проходом,
    // без ожидания retention — биометрия, которую юзер просил удалить, не должна
    // жить до 7 суток из-за одного сбоя storage.
    const toClean = await db.select({
        id: speakingSubmission.id, audioPath: speakingSubmission.audioPath,
        userId: speakingSubmission.userId, deleteRequestedAt: speakingSubmission.deleteRequestedAt,
      }).from(speakingSubmission)
      .where(and(
        isNull(speakingSubmission.audioDeletedAt),
        or(
          lt(speakingSubmission.createdAt, retentionBefore),
          isNotNull(speakingSubmission.deleteRequestedAt),
          isNotNull(speakingSubmission.audioDeleteError),
        ),
      ));

    // Dedup by id (a stuck row may also be retention-old → in both sets).
    const targets = [...new Map([...stuck, ...toClean].map((t) => [t.id, t])).values()];
    let cleaned = 0;
    for (const t of targets) {
      // Mark deleted ONLY after the object is actually gone. A failed remove used to be
      // logged then marked deleted anyway → orphan biometrics past retention forever, never
      // retried (next pass skips audio_deleted_at IS NOT NULL) (#6). Now keep it retryable.
      try {
        await deleteAudio(t.audioPath);
      } catch (e) {
        await markAudioDeleteFailed(t.id, String(e));
        console.error("reaper delete failed", t.id, e);
        continue;
      }
      // Честная причина в аудит-событии: доделанный user-delete ≠ retention.
      await markAudioDeleted(t.id, t.userId, t.deleteRequestedAt ? "user" : "retention");
      cleaned++;
    }
    return NextResponse.json({ ok: true, failed: stuck.length, cleaned }, { status: 200 });
  } catch (e) {
    await logError({
      source: "server",
      message: `speaking-reaper cron failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      url: request.url,
      context: { route: "/api/cron/speaking-reaper" },
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
