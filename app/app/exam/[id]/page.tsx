import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contentItem } from "@/db/schema";
import { getProfile, requireUser } from "@/lib/auth";
import { enforceAccess, startAttempt } from "@/lib/exam/access";
import { effectiveTier, type Tier } from "@/lib/tiers";
import { isUuid } from "@/lib/uuid";
import ExamFrame from "./ExamFrame";

export default async function ExamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  // Malformed id never reaches the uuid-column query (would 500 on cast); 404 instead.
  if (!isUuid(id)) notFound();

  // content_item (раннер + требуемый tier) и профиль независимы → один параллельный
  // слой. Раньше страница читала content_item, а старт через loadAccessData читал его
  // второй раз — required tier берётся здесь же, дубль content_item убран.
  const [[test], profile] = await Promise.all([
    db
      .select({ runnerHtml: contentItem.runnerHtml, tierRequired: contentItem.tierRequired })
      .from(contentItem)
      // Published-only: owner-path bypasses RLS, so a draft id must notFound() here
      // too (parity with the catalog's content_item_select_published policy).
      .where(and(eq(contentItem.id, id), eq(contentItem.status, "published"))),
    getProfile(),
  ]);
  if (!test?.runnerHtml) notFound();

  // Tier-гейт §4.8 (effectiveTier понижает истёкший premium до basic) + дневной лимит
  // Basic. submitAttempt перепроверяет тот же гейт (defense-in-depth). startAttempt
  // ниже стартует/резюмит attempt уже ПОСЛЕ гейта (server-stamped started_at).
  const userTier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";
  await enforceAccess(user.id, userTier, test.tierRequired);

  const { attemptId } = await startAttempt(user.id, id);
  return <ExamFrame attemptId={attemptId} contentItemId={id} />;
}
