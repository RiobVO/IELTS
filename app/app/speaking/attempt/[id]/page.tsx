import { notFound, redirect } from "next/navigation";
import { getProfile, getUser } from "@/lib/auth";
import { speakingFeatureEnabled } from "@/env";
import { isUuid } from "@/lib/uuid";
import { loadPublishedTask } from "@/lib/speaking/read";
import { AppShell } from "../../../_AppShell";
import { Attempt } from "./_Attempt";

export const dynamic = "force-dynamic";

/**
 * Speaking attempt (`/app/speaking/attempt/[id]`). Disabled-safe redirect; 404 for a
 * bad id or an unpublished cue-card. Consent is read here (profile.recording_consent_at)
 * so the client can gate the recorder behind the consent modal on first use.
 */
export default async function SpeakingAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/auth");
  if (!speakingFeatureEnabled()) redirect("/app/practice");

  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [profile, task] = await Promise.all([getProfile(), loadPublishedTask(id)]);
  if (!task) notFound();

  const hasConsent = !!(profile as { recording_consent_at?: string | null } | null)?.recording_consent_at;

  return (
    <AppShell active="practice">
      <Attempt task={task} hasConsent={hasConsent} />
    </AppShell>
  );
}
