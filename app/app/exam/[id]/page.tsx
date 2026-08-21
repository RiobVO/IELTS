import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { attempt, contentItem, passage } from "@/db/schema";
import { DraftPreviewBadge } from "@/components/exam/DraftPreviewBadge";
import { ModeStart } from "@/components/exam/ModeStart";
import { getProfile, isAdminProfile, requireUser } from "@/lib/auth";
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
  searchParams: Promise<{ mode?: string; min?: string; focus?: string; preview?: string }>;
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
        status: contentItem.status,
      })
      .from(contentItem)
      .where(eq(contentItem.id, id)),
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
  if (!test) notFound();
  // F4 "Sit as student": owner-path запрос выше больше не фильтрует status=
  // 'published' в SQL — гейт применяется здесь, admin исключается. Byte-identical
  // для не-админа (draft/несуществующий id -> тот же notFound()).
  const isAdmin = isAdminProfile(profile);
  const isDraftPreview = test.status !== "published";
  if (isDraftPreview && !isAdmin) notFound();
  if (!test.runnerHtml) notFound();
  // F4: admin-preview = черновик ЛИБО явный ?preview=1 на published (ссылка «Sit as
  // student» из админки). Роль проверяется СЕРВЕРОМ — сам флаг не-админу ничего не
  // даёт (для него preview просто игнорируется, поведение обычное).
  const adminPreview = isAdmin && (isDraftPreview || sp.preview === "1");

  // Tier-гейт §4.8 (effectiveTier понижает истёкший premium до basic) + дневной
  // Basic-кап (P0: только mock; на экране выбора mode=null → кап не применим,
  // реальный старт перезаходит сюда с выбранным режимом). submitAttempt
  // перепроверяет тот же гейт (defense-in-depth).
  const userTier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";
  // F4: admin-preview форсирует practice БЕЗУСЛОВНО — и для новой попытки, и для
  // резюма. Резюмируемая mock-попытка конвертится в practice ПРЯМО В БД: submit
  // читает attempt.mode из БД (shouldRateAttempt рейтингует mock), поэтому
  // in-memory релейбл не защитил бы рейтинг. Update — owner-scoped, только
  // in_progress; создать вторую practice-попытку рядом нельзя (partial-индекс 0007
  // держит одну in_progress на (user, test)), значит конверсия — единственный
  // способ резюмить без mock-хвоста.
  let resume = existing;
  if (adminPreview && existing && existing.mode === "mock") {
    const converted = await db
      .update(attempt)
      .set({ mode: "practice" })
      .where(
        and(
          eq(attempt.id, existing.id),
          eq(attempt.userId, user.id),
          eq(attempt.status, "in_progress"),
        ),
      )
      .returning({ id: attempt.id });
    // 0 строк — попытка уже не in_progress (конкурентный submit из другого таба):
    // resume из устаревшего снапшота строить нельзя (in-memory разошёлся бы с
    // БД-строкой) → идём путём «existing отсутствует»: startAttempt создаст свежую
    // practice-попытку обычной механикой, остаток гонки разрулит ON CONFLICT (0007).
    resume = converted.length > 0 ? { ...existing, mode: "practice" } : null;
  }
  const mode = adminPreview ? "practice" : (existing?.mode ?? modeParam);
  // Basic caps (2 practice/день + 2 mock/неделю, owner decision 2026-07-17) —
  // только на создание НОВОГО attempt; резюм существующей попытки (mode=null
  // ниже) не расходует слот и не должен блокироваться (tier-гейт применяется
  // всегда). Эта проверка — soft early-check; авторитетная живёт внутри
  // транзакции startAttempt.
  await enforceAccess(
    user.id,
    userTier,
    test.tierRequired,
    test.category,
    id,
    existing ? null : modeParam,
    isDraftPreview, // adminDraftBypass — только когда isAdmin уже подтверждён выше
  );

  // Practice → атомизированный раннер (стратегия A), если тесту есть на чём жить:
  // пассажи с телом, а для listening ещё и привязанное аудио (легаси-раннер играет
  // passage.audio_path; без него listening отрендерился бы как reading). Иначе —
  // practice-lite в iframe. Mock всегда остаётся в iframe (fidelity). Attempt общий
  // для обоих роутов (ensureAttempt по (user, test)), редирект ничего не теряет.
  const practiceServable =
    !!atomized && (test.section === "reading" || !!withAudio);
  if (mode === "practice" && practiceServable) {
    // preview-флаг протаскивается в атомизированный раннер (там та же серверная
    // проверка роли) — иначе admin-preview потерялся бы на редиректе.
    const previewQS = adminPreview ? "&preview=1" : "";
    redirect(`/app/reading/${id}?mode=practice${previewQS}${focusQS}`);
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
  // trial-старт: H3-атомарный claim в startAttempt. Admin-draft-preview — НЕ trial
  // (доступ дан bypass'ом, не расходом слота): forced false, иначе admin с
  // tier < tierRequired молча съел бы свой единственный trial на QA-прогоне.
  const isTrial = !isDraftPreview && !meetsTier(userTier, test.tierRequired);
  // `resume` из батча выше (с mock→practice конверсией admin-preview) — резюм без
  // повторного SELECT той же строки. userTier — авторитетная Basic-кап проверка
  // теперь внутри транзакции startAttempt (не только soft-check в enforceAccess).
  const { attemptId } = await startAttempt(user.id, id, mode, isTrial, resume, userTier);
  // Лимит mock из URL (?min=) — от пресетов ModeStart; clamp против ручных значений
  // (та же валидация, что в /app/reading). В iframe уходит только для mock: раннер
  // синхронизирует внутренний mock-таймер с этим значением (forceRunnerMode).
  const minRaw = Math.round(Number(sp.min));
  const mockMinutes = Number.isFinite(minRaw)
    ? Math.min(180, Math.max(5, minRaw))
    : null;
  return (
    <>
      {isDraftPreview && <DraftPreviewBadge />}
      <ExamFrame
        attemptId={attemptId}
        contentItemId={id}
        mockMinutes={mode === "mock" ? mockMinutes : null}
      />
    </>
  );
}
