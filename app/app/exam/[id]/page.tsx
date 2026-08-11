import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contentItem } from "@/db/schema";
import { ModeStart } from "@/components/exam/ModeStart";
import { getProfile, requireUser } from "@/lib/auth";
import {
  type AttemptMode,
  enforceAccess,
  findInProgressAttempt,
  hasSubmittedAttempt,
  startAttempt,
} from "@/lib/exam/access";
import { categoryLabel } from "@/lib/labels";
import { effectiveTier, type Tier } from "@/lib/tiers";
import { isUuid } from "@/lib/uuid";
import ExamFrame from "./ExamFrame";

export default async function ExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  // Malformed id never reaches the uuid-column query (would 500 on cast); 404 instead.
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const modeParam: AttemptMode | null =
    sp.mode === "practice" || sp.mode === "mock" ? sp.mode : null;

  // content_item (раннер + требуемый tier), профиль и attempt-факты (незакрытая
  // попытка / была ли сдача) независимы → один параллельный слой. Незакрытая
  // попытка резюмится со СВОИМ mode; иначе режим берётся из ?mode=, а без него
  // рендерится экран выбора (attempt при этом НЕ создаётся).
  const [[test], profile, existing, attempted] = await Promise.all([
    db
      .select({
        runnerHtml: contentItem.runnerHtml,
        tierRequired: contentItem.tierRequired,
        title: contentItem.title,
        section: contentItem.section,
        category: contentItem.category,
      })
      .from(contentItem)
      // Published-only: owner-path bypasses RLS, so a draft id must notFound() here
      // too (parity with the catalog's content_item_select_published policy).
      .where(and(eq(contentItem.id, id), eq(contentItem.status, "published"))),
    getProfile(),
    findInProgressAttempt(user.id, id),
    hasSubmittedAttempt(user.id, id),
  ]);
  if (!test?.runnerHtml) notFound();

  // Tier-гейт §4.8 (effectiveTier понижает истёкший premium до basic) + дневной
  // Basic-кап (P0: только mock; на экране выбора mode=null → кап не применим,
  // реальный старт перезаходит сюда с выбранным режимом). submitAttempt
  // перепроверяет тот же гейт (defense-in-depth).
  const userTier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";
  const mode = existing?.mode ?? modeParam;
  // Кап — только на создание НОВОГО mock; резюм существующей попытки не расходует
  // слот и не должен блокироваться (tier-гейт применяется всегда).
  await enforceAccess(user.id, userTier, test.tierRequired, existing ? null : modeParam);

  if (!mode) {
    return (
      <ModeStart
        title={test.title}
        meta={categoryLabel(test.category)}
        href={`/app/exam/${id}`}
        alreadyAttempted={attempted}
        listening={test.section === "listening"}
      />
    );
  }

  const { attemptId } = await startAttempt(user.id, id, mode);
  return <ExamFrame attemptId={attemptId} contentItemId={id} />;
}
