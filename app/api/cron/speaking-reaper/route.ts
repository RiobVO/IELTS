import { NextResponse } from "next/server";
import { and, inArray, lt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { speakingSubmission } from "@/db/schema";
import { isCronAuthorized } from "@/lib/cron-auth";
import { deleteAudio } from "@/lib/speaking/storage";
import { markAudioDeleted } from "@/lib/speaking/store";

export const dynamic = "force-dynamic";
const STALE_MS = Number(process.env.SPEAKING_STALE_MS ?? 120000);
const RETENTION_DAYS = Number(process.env.SPEAKING_AUDIO_RETENTION_DAYS ?? 7);

export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET ?? null)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
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
    .returning({ id: speakingSubmission.id, audioPath: speakingSubmission.audioPath, userId: speakingSubmission.userId });

  // (2) Delete orphan/retention audio: rows whose audio still exists but is either
  // just-failed-stuck above, or completed older than retention (defensive — eval
  // already deletes on success), or a stale 'uploading' orphan object.
  const toClean = await db.select({
      id: speakingSubmission.id, audioPath: speakingSubmission.audioPath, userId: speakingSubmission.userId,
    }).from(speakingSubmission)
    .where(and(
      isNull(speakingSubmission.audioDeletedAt),
      lt(speakingSubmission.createdAt, retentionBefore),
    ));

  // Dedup by id (a stuck row may also be retention-old → in both sets).
  const targets = [...new Map([...stuck, ...toClean].map((t) => [t.id, t])).values()];
  for (const t of targets) {
    await deleteAudio(t.audioPath).catch((e) => console.error("reaper delete failed", t.id, e));
    await markAudioDeleted(t.id, t.userId, "retention");
  }
  return NextResponse.json({ ok: true, failed: stuck.length, cleaned: targets.length }, { status: 200 });
}
