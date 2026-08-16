import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getProfile, getUser } from "@/lib/auth";
import { getHeaderData } from "@/lib/notifications/header-data";
import { writingFeatureEnabled } from "@/env";
import { isUuid } from "@/lib/uuid";
import { readFeedbackResult } from "@/lib/writing/read";
import { AppShell } from "../../../_AppShell";
import { FeedbackView } from "./_FeedbackView";

export const dynamic = "force-dynamic";
// Статичный title (не generateMetadata): единственный read, дающий тему эссе
// (readFeedbackResult), owner-scoped — генерации метаданных пришлось бы повторно
// звать getUser() и тащить весь feedback-джойн ради заголовка вкладки. Не стоит того.
export const metadata: Metadata = { title: "Writing result | bando" };

/**
 * Feedback result (`/app/writing/result/[id]`). Owner-scoped read — only the
 * submission's owner, only once the snapshot exists. Disabled-safe redirect; 404
 * for a bad id or someone else's/an incomplete submission.
 */
export default async function WritingResultPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/auth");
  if (!writingFeatureEnabled()) redirect("/app/practice");
  // Пре-варм данных шапки конкурентно (cache()'d; AppShell reuses).
  void getHeaderData();

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
