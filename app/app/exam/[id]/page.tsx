import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { contentItem, passage } from "@/db/schema";
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
import { effectiveTier, meetsTier, type Tier } from "@/lib/tiers";
import { isUuid } from "@/lib/uuid";
import ExamFrame from "./ExamFrame";

// Динамический title вкладки — заголовок теста вместо статичного дефолта из layout.tsx.
// Чистый read-only запрос (без enforceAccess/startAttempt): generateMetadata не должна
// триггерить сайд-эффекты (создание attempt, редиректы) логики самой страницы.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Exam | bando" };
  // Published-гейт — тот же, что у страничного запроса ниже (строка ~74): draft-id не
  // должен светить title в <title> вкладки раньше собственного 404 страницы.
  const [row] = await db
    .select({ title: contentItem.title })
    .from(contentItem)
    .where(and(eq(contentItem.id, id), eq(contentItem.status, "published")))
    .limit(1);
  return { title: `${row?.title ?? "Exam"} | bando` };
}

export default async function ExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; focus?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  // Malformed id never reaches the uuid-column query (would 500 on cast); 404 instead.
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const modeParam: AttemptMode | null =
    sp.mode === "practice" || sp.mode === "mock" ? sp.mode : null;
  // P15 — deep-link фокус вопроса (из /app/practice/mistakes). Здесь только санация до
  // int для протаскивания в redirect; валидацию по реальным номерам делает
  // /app/reading/[id]. В iframe-ветке (practice-lite/mock) параметр не используется.
  const focusRaw = Math.round(Number(sp.focus));
  const focusQS = Number.isFinite(focusRaw) && focusRaw >= 1 ? `&focus=${focusRaw}` : "";

  // content_item (раннер + требуемый tier), профиль и attempt-факты (незакрытая
  // попытка / была ли сдача) независимы → один параллельный слой. Незакрытая
  // попытка резюмится со СВОИМ mode; иначе режим берётся из ?mode=, а без него
  // рендерится экран выбора (attempt при этом НЕ создаётся).
  const [[test], profile, existing, attempted, [atomized], [withAudio]] = await Promise.all([
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
    // Стратегия A (PRACTICE_PLAN): practice живёт на атомизированной поверхности,
    // mock — в iframe. Два EXISTS-факта решают, есть ли ей на чём жить.
    db
      .select({ id: passage.id })
      .from(passage)
      .where(and(eq(passage.contentItemId, id), ne(passage.bodyHtml, "")))
      .limit(1),
    db
      .select({ id: passage.id })
      .from(passage)
      .where(and(eq(passage.contentItemId, id), isNotNull(passage.audioPath)))
      .limit(1),
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
  await enforceAccess(user.id, userTier, test.tierRequired, test.category, id, existing ? null : modeParam);

  // Practice → атомизированный раннер (стратегия A), если тесту есть на чём жить:
  // пассажи с телом, а для listening ещё и привязанное аудио (легаси-раннер играет
  // passage.audio_path; без него listening отрендерился бы как reading). Иначе —
  // practice-lite в iframe. Mock всегда остаётся в iframe (fidelity). Attempt общий
  // для обоих роутов (ensureAttempt по (user, test)), редирект ничего не теряет.
  const practiceServable =
    !!atomized && (test.section === "reading" || !!withAudio);
  if (mode === "practice" && practiceServable) {
    redirect(`/app/reading/${id}?mode=practice${focusQS}`);
  }

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

  // Пройти enforceAccess с !meetsTier можно только по trial-лейну (§4.8) → это
  // trial-старт: H3-атомарный claim в startAttempt.
  const isTrial = !meetsTier(userTier, test.tierRequired);
  const { attemptId } = await startAttempt(user.id, id, mode, isTrial);
  return <ExamFrame attemptId={attemptId} contentItemId={id} />;
}
