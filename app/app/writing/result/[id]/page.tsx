import { notFound, redirect } from "next/navigation";
import { getProfile, getUser } from "@/lib/auth";
import { writingEvalConfig } from "@/env";
import { isUuid } from "@/lib/uuid";
import { readFeedbackResult } from "@/lib/writing/read";
import { AppShell } from "../../../_AppShell";
import { FeedbackView } from "./_FeedbackView";

export const dynamic = "force-dynamic";

/**
 * Feedback result (`/app/writing/result/[id]`). Owner-scoped read — only the
 * submission's owner, only once the snapshot exists. Disabled-safe redirect; 404
 * for a bad id or someone else's/an incomplete submission.
 */
export default async function WritingResultPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/auth");
  if (writingEvalConfig() === null) redirect("/app/practice");

  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [profile, data] = await Promise.all([getProfile(), readFeedbackResult(user.id, id)]);
  if (!data) notFound();

  const rawTarget = (profile as { target_band: string | number | null } | null)?.target_band;
  const targetBand = rawTarget != null ? Number(rawTarget) : 7;

  return (
    <AppShell active="practice">
      <FeedbackView data={data} targetBand={targetBand} />
    </AppShell>
  );
}
