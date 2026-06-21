import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { annotation } from "@/db/schema";
import { effectiveTier, meetsTier, type Tier } from "@/lib/tiers";
import { normalizePassageHtml } from "@/lib/reading/normalize-passage";
import { ensureAttempt } from "./actions";
import ExamRunner from "./ExamRunner";

export const dynamic = "force-dynamic";

interface Question {
  id: string;
  number: number;
  qtype: string;
  prompt_html: string;
  options: { value: string; label: string }[] | null;
  // passage_id → группировка вопросов по Part в нижнем навигаторе (read существующей колонки).
  passage_id: string | null;
}

export default async function ReadingTestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const supabase = await createClient();

  // content_item, профиль, пассажи и вопросы независимы → один параллельный слой
  // вместо «single, потом Promise.all» (content_item был отдельным RT перед батчем).
  // answer_key намеренно НЕ выбирается (RLS-locked; не утекает до submit).
  const [testRes, profile, passagesRes, questionsRes] = await Promise.all([
    supabase
      .from("content_item")
      .select("id,title,category,duration_seconds,tier_required")
      .eq("id", id)
      .single(),
    getProfile(),
    supabase
      .from("passage")
      .select('title,body_html,"order",audio_path,questions_html')
      .eq("content_item_id", id)
      .order("order"),
    supabase
      .from("question")
      .select("id,number,qtype,prompt_html,options,group_key,passage_id")
      .eq("content_item_id", id)
      .order("number"),
  ]);
  const test = testRes.data;
  if (!test) notFound();
  // Нормализуем разметку абзацев каждого пассажа к единому контракту (.rp +
  // data-letter) на read-time — вся разнородность форматов в одной тестируемой
  // функции, PassagePane рисует один CSS-путь. audio_path/order/title сохраняются.
  const passages = passagesRes.data?.map((p) => ({
    ...p,
    body_html: normalizePassageHtml((p as { body_html: string }).body_html, test.title),
  }));
  const questionsData = questionsRes.data;

  // Verbatim question-panel HTML (real-IELTS render). Используем, только если ВСЕ
  // пассажи его несут (иначе — фоллбэк на атомизированный список). Listening и
  // старые/непокрытые тесты → null → текущий рендер.
  const qHtmlParts = (passagesRes.data ?? []).map(
    (p) => (p as { questions_html: string | null }).questions_html,
  );
  const questionsHtml =
    qHtmlParts.length > 0 && qHtmlParts.every(Boolean) ? qHtmlParts.join("\n") : null;

  // Access gate (§4.8): a Basic user must not even reach the exam for a
  // Premium/Ultra test. effectiveTier downgrades an expired premium to basic,
  // so a stale profile.tier can't slip past. The submit action re-checks
  // server-side (defense in depth) — this redirect is the UX-facing guard.
  const userTier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";
  if (!meetsTier(userTier, test.tier_required as Tier)) redirect("/app/upgrade");

  // Listening: one audio file for the whole test. Local public/ path now;
  // a full Storage URL (signed, §11) once audio lives in the cloud.
  const rawAudio =
    (passages ?? []).find((p) => (p as { audio_path: string | null }).audio_path)
      ?.audio_path ?? null;
  const audioSrc = rawAudio
    ? /^https?:\/\//.test(rawAudio)
      ? rawAudio
      : `/${rawAudio.replace(/^\/+/, "")}`
    : null;

  // Открытие/resume attempt (серверный гейт §4.8) и чтение аннотаций пользователя
  // независимы → параллелим (annotations был отдельным RT-слоем ПОСЛЕ ensureAttempt).
  // Оба после tier-гейта: annotations read-only/user-scoped, attempt re-проверяет доступ.
  const [{ attemptId, answers: savedAnswers }, annotations] = await Promise.all([
    ensureAttempt(id),
    // Reader annotations (W2-1) — owner-path read of the user's own highlights/notes
    // for this test (RLS-safe; user-scoped). Passed to the passage pane to re-apply.
    db
      .select({
        id: annotation.id,
        passage_order: annotation.passageOrder,
        kind: annotation.kind,
        start_offset: annotation.startOffset,
        end_offset: annotation.endOffset,
        quote: annotation.quote,
        note: annotation.note,
      })
      .from(annotation)
      .where(and(eq(annotation.userId, user.id), eq(annotation.contentItemId, id)))
      .orderBy(asc(annotation.createdAt)),
  ]);

  return (
    <ExamRunner
      attemptId={attemptId}
      contentItemId={id}
      initialAnswers={savedAnswers}
      passages={(passages ?? []) as never}
      questions={(questionsData ?? []) as Question[]}
      durationSeconds={test.duration_seconds}
      audioSrc={audioSrc}
      title={test.title}
      category={test.category}
      initialAnnotations={annotations as never}
      questionsHtml={questionsHtml}
    />
  );
}
