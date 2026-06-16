import { notFound, redirect } from "next/navigation";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { effectiveTier, meetsTier, type Tier } from "@/lib/tiers";
import { ensureAttempt } from "./actions";
import ExamRunner from "./ExamRunner";

export const dynamic = "force-dynamic";

interface Question {
  id: string;
  number: number;
  qtype: string;
  prompt_html: string;
  options: { value: string; label: string }[] | null;
}

export default async function ReadingTestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const supabase = await createClient();

  const { data: test } = await supabase
    .from("content_item")
    .select("id,title,category,duration_seconds,tier_required")
    .eq("id", id)
    .single();
  if (!test) notFound();

  // Профиль и контент теста (пассажи + вопросы) независимы → тянем параллельно
  // одним round-trip-ом вместо трёх последовательных. answer_key намеренно НЕ
  // выбирается (RLS-locked; не утекает до submit).
  const [profile, passagesRes, questionsRes] = await Promise.all([
    getProfile(),
    supabase
      .from("passage")
      .select('title,body_html,"order",audio_path')
      .eq("content_item_id", id)
      .order("order"),
    supabase
      .from("question")
      .select("id,number,qtype,prompt_html,options,group_key")
      .eq("content_item_id", id)
      .order("number"),
  ]);
  const passages = passagesRes.data;
  const questionsData = questionsRes.data;

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

  // Open (or resume) the server-stamped in_progress attempt — also re-runs the
  // access + daily-limit gate (§4.8) authoritatively before the exam loads.
  const { attemptId, answers: savedAnswers } = await ensureAttempt(id);

  return (
    <ExamRunner
      attemptId={attemptId}
      initialAnswers={savedAnswers}
      passages={(passages ?? []) as never}
      questions={(questionsData ?? []) as Question[]}
      durationSeconds={test.duration_seconds}
      audioSrc={audioSrc}
      title={test.title}
      category={test.category}
    />
  );
}
