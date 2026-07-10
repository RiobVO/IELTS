import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getHeaderData } from "@/lib/notifications/header-data";
import { speakingFeatureEnabled } from "@/env";
import { listUserHistory } from "@/lib/speaking/read";
import { AppShell } from "../../_AppShell";
import { SpeakingHistory } from "./_History";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Speaking history | bando" };

/**
 * Speaking attempt history (`/app/speaking/history`). Owner-scoped grid of completed
 * analyses; each is an immutable snapshot. Deleting a recording wipes the audio +
 * transcript (the band/feedback stay) — handled client-side, so the grid is a client
 * island fed server data. Disabled-safe redirect.
 */
export default async function SpeakingHistoryPage() {
  const user = await getUser();
  if (!user) redirect("/auth");
  if (!speakingFeatureEnabled()) redirect("/app/practice");
  // Пре-варм данных шапки конкурентно (cache()'d; AppShell reuses).
  void getHeaderData();

  const rows = await listUserHistory(user.id);

  return (
    <AppShell active="practice">
      <SpeakingHistory rows={rows} />
    </AppShell>
  );
}
