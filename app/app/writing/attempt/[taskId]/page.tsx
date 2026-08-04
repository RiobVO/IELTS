import { notFound, redirect } from "next/navigation";
import { getProfile, requireUser } from "@/lib/auth";
import { writingFeatureEnabled } from "@/env";
import { isUuid } from "@/lib/uuid";
import { loadPublishedTask } from "@/lib/writing/read";
import { AppShell } from "../../../_AppShell";
import { Attempt } from "./_Attempt";

export const dynamic = "force-dynamic";

/**
 * Attempt screen (`/app/writing/attempt/[taskId]`). Disabled-safe redirect to
 * Practice; 404 on a bad/unpublished task. Loads the prompt owner-path and hands
 * the async write→evaluate→poll flow to the client component.
 */
export default async function AttemptPage({ params }: { params: Promise<{ taskId: string }> }) {
  await requireUser();
  if (!writingFeatureEnabled()) redirect("/app/practice");

  const { taskId } = await params;
  if (!isUuid(taskId)) notFound();

  const [profile, task] = await Promise.all([getProfile(), loadPublishedTask(taskId)]);
  if (!task) notFound();

  const rawTarget = (profile as { target_band: string | number | null } | null)?.target_band;
  const targetBand = rawTarget != null ? Number(rawTarget) : 7;

  return (
    <AppShell active="practice">
      <Attempt task={task} targetBand={targetBand} />
    </AppShell>
  );
}
