import { notFound, redirect } from "next/navigation";
import { getProfile, getUser } from "@/lib/auth";
import { speakingFeatureEnabled } from "@/env";
import { isUuid } from "@/lib/uuid";
import { readFeedbackResult } from "@/lib/speaking/read";
import { signedPlaybackUrl } from "@/lib/speaking/storage";
import { AppShell } from "../../../_AppShell";
import { SpeakingResult } from "./_Result";

export const dynamic = "force-dynamic";

/**
 * Speaking feedback result (`/app/speaking/result/[id]`). Owner-scoped read — only
 * the submission's owner, only once the snapshot exists. Disabled-safe redirect; 404
 * for a bad id or someone else's / an incomplete submission.
 */
export default async function SpeakingResultPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/auth");
  if (!speakingFeatureEnabled()) redirect("/app/practice");

  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [profile, data] = await Promise.all([getProfile(), readFeedbackResult(user.id, id)]);
  if (!data) notFound();

  // Sign a short-lived playback URL only while the take still exists (owner-scoped read
  // above; service-role sign here, server-only). Audio gone → null → no player. Then strip
  // audioPath (a private-bucket key) so it never reaches the client — the client only needs
  // the signed URL, never the raw path (#19).
  const { audioPath, ...view } = data;
  const audioUrl = audioPath ? await signedPlaybackUrl(audioPath) : null;

  const rawTarget = (profile as { target_band: string | number | null } | null)?.target_band;
  const targetBand = rawTarget != null ? Number(rawTarget) : 7;

  return (
    <AppShell active="practice">
      <SpeakingResult data={view} targetBand={targetBand} audioUrl={audioUrl} />
    </AppShell>
  );
}
