import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProfile, requireUser } from "@/lib/auth";
import { db } from "@/db";
import { annotation, answerKey, contentItem, question } from "@/db/schema";
import { getExamContent } from "@/lib/content/exam-content";
import { ModeStart } from "@/components/exam/ModeStart";
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
import { normalizePassageHtml } from "@/lib/reading/normalize-passage";
import ExamRunner from "./ExamRunner";

export const dynamic = "force-dynamic";

// Динамический title вкладки — заголовок теста вместо статичного дефолта из layout.tsx.
// Чистый read-only запрос (без getExamContent/enforceAccess): generateMetadata не должна
// триггерить сайд-эффекты (создание attempt, редиректы) логики самой страницы.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Practice | bando" };
  // Published-гейт — тот же, что у getExamContent (exam-content.ts): draft/несуществующий
  // id не должен светить title в <title> вкладки раньше собственного 404 страницы.
  const [row] = await db
    .select({ title: contentItem.title })
    .from(contentItem)
    .where(and(eq(contentItem.id, id), eq(contentItem.status, "published")))
    .limit(1);
  return { title: `${row?.title ?? "Practice"} | bando` };
}

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; min?: string; focus?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  // Malformed id не должен доезжать до uuid-каста в Drizzle (invalid input syntax →
  // 500); раньше 404 давал anon-клиент `.single()`, теперь гейтим сами (зеркало result).
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const modeParam: AttemptMode | null =
    sp.mode === "practice" || sp.mode === "mock" ? sp.mode : null;

  // Статичный published-контент (метаданные теста + пассажи + вопросы) вынесен в
  // unstable_cache (W2-6): под нагрузкой рендер экзамена не бьёт БД за ним на каждый
  // старт — сбрасывается тегом на (ре)импорте/публикации. Профиль и attempt-факты
  // (незакрытая попытка / была ли сдача) — per-user, считаются ВНЕ кэша, на каждый
  // запрос, параллельно с чтением контента. answer_key намеренно НЕ читается (в кэш
  // не попадает; не утекает до submit).
  const [content, profile, existing, attempted] = await Promise.all([
    getExamContent(id),
    getProfile(),
    findInProgressAttempt(user.id, id),
    hasSubmittedAttempt(user.id, id),
  ]);
  // getExamContent гейтит status='published' (owner-путь обходит RLS) → draft/
  // отсутствие = null = 404, тот же гейт, что раньше давал anon-клиент.
  if (!content) notFound();
  const { test } = content;
  // Нормализуем разметку абзацев каждого пассажа к единому контракту (.rp +
  // data-letter) на read-time — вся разнородность форматов в одной тестируемой
  // функции, PassagePane рисует один CSS-путь. audio_path/order/title сохраняются.
  const passages = content.passages.map((p) => ({
    ...p,
    body_html: normalizePassageHtml(p.body_html, test.title),
  }));
  const questionsData = content.questions;

  // Verbatim question-panel HTML (real-IELTS render). Используем, только если ВСЕ
  // пассажи его несут (иначе — фоллбэк на атомизированный список). Listening и
  // старые/непокрытые тесты → null → текущий рендер.
  const qHtmlParts = content.passages.map((p) => p.questions_html);
  const questionsHtml =
    qHtmlParts.length > 0 && qHtmlParts.every(Boolean) ? qHtmlParts.join("\n") : null;

  // Access gate (§4.8): tier entitlement + Basic daily mock-cap (P0), enforced
  // server-side from the profile + content_item already read above (no extra
  // round-trip). effectiveTier downgrades an expired premium to basic, so a stale
  // profile.tier can't slip past. submitAttempt re-runs the same gate (defense in
  // depth); startAttempt below assumes it has already passed. Незакрытая попытка
  // резюмится со СВОИМ mode; без попытки и без ?mode= — экран выбора (attempt не
  // создаётся, кап на экране не применим: mode=null).
  const userTier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";
  const mode = existing?.mode ?? modeParam;
  // Кап — только на создание НОВОГО mock; резюм существующей попытки не расходует
  // слот и не должен блокироваться (tier-гейт применяется всегда).
  await enforceAccess(user.id, userTier, test.tier_required as Tier, test.category, id, existing ? null : modeParam);

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

  // Дефолт лимита mock — из длительности теста, иначе по объёму (та же шкала,
  // что жила в клиентском StartScreen до P0).
  const questionCount = questionsData?.length ?? 0;
  // P15 — deep-link фокус вопроса (навигация из /app/practice/mistakes). Валидируем по
  // РЕАЛЬНЫМ номерам вопросов (одиночный пассаж нумеруется не с 1), иначе undefined.
  const focusRaw = Math.round(Number(sp.focus));
  const questionNumbers = new Set((questionsData ?? []).map((q) => q.number));
  const focusNumber =
    Number.isFinite(focusRaw) && questionNumbers.has(focusRaw) ? focusRaw : undefined;
  const defaultMockMinutes =
    test.duration_seconds != null
      ? Math.max(5, Math.round(test.duration_seconds / 60))
      : questionCount >= 40
        ? 60
        : questionCount >= 27
          ? 40
          : 20;

  if (!mode) {
    return (
      <ModeStart
        title={test.title}
        meta={`${categoryLabel(test.category)} · ${questionCount} questions`}
        href={`/app/reading/${id}`}
        mockPresets={
          audioSrc
            ? null // Listening: длительность задаёт запись, лимит не выбирается
            : Array.from(new Set([20, 40, 60, defaultMockMinutes])).sort((a, b) => a - b)
        }
        defaultMinutes={defaultMockMinutes}
        alreadyAttempted={attempted}
        listening={!!audioSrc}
      />
    );
  }

  // Лимит mock из URL (?min=) — от пресетов ModeStart; clamp против ручных значений.
  const minParam = Math.round(Number(sp.min));
  const mockMinutes = Number.isFinite(minParam)
    ? Math.min(180, Math.max(5, minParam))
    : defaultMockMinutes;

  // Открытие/resume attempt и чтение аннотаций пользователя независимы → параллелим
  // (annotations был отдельным RT-слоем ПОСЛЕ старта). Доступ уже сгейчен выше
  // (enforceAccess), поэтому startAttempt не перечитывает content_item/profile.
  // P2b-2 — какие вопросы имеют локатор ДО reveal. Только practice-reading (mock и
  // listening — без; listening покрытие evidence.para = 0). owner-path (Drizzle bypass
  // RLS), НО в клиент уходит лишь number[] — булево «есть куда посмотреть», НЕ сам para
  // и НЕ ключ. Строго слабее уже существующего P7-reveal (тот отдаёт para после
  // reveal). qtype-гейт зеркалит locateEvidence (matching_info/headings: para≈ответ).
  const locatorEligible = mode === "practice" && !audioSrc;

  // Пройти enforceAccess с !meetsTier можно только по trial-лейну (§4.8) → trial-старт:
  // H3-атомарный claim в startAttempt.
  const isTrial = !meetsTier(userTier, test.tier_required as Tier);
  const [{ attemptId, answers: savedAnswers, mode: attemptMode }, annotations, locatableRows] = await Promise.all([
    startAttempt(user.id, id, mode, isTrial),
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
    locatorEligible
      ? db
          .select({ number: question.number })
          .from(question)
          .innerJoin(answerKey, eq(answerKey.questionId, question.id))
          .where(
            and(
              eq(question.contentItemId, id),
              // evidence.para присутствует и непустой (мягче: NULL и '' отсекаются разом).
              sql`${answerKey.evidence} ->> 'para' <> ''`,
              notInArray(question.qtype, ["matching_info", "matching_headings"]),
            ),
          )
          .orderBy(asc(question.number))
      : Promise.resolve([] as { number: number }[]),
  ]);

  return (
    <ExamRunner
      // Смена попытки = свежий инстанс: refs single-pass/таймера не переживают attempt.
      key={attemptId}
      attemptId={attemptId}
      contentItemId={id}
      mode={attemptMode}
      mockMinutes={mockMinutes}
      initialAnswers={savedAnswers}
      passages={(passages ?? []) as never}
      questions={(questionsData ?? []) as Question[]}
      durationSeconds={test.duration_seconds}
      audioSrc={audioSrc}
      title={test.title}
      category={test.category}
      initialAnnotations={annotations as never}
      // Practice — учебная поверхность: всегда атомизированный рендер, иначе verbatim
      // questions_html спрятал бы P6/P7 (check/reveal) и P1-подсказки, которые живут
      // в QuestionBlock. Fidelity-verbatim остаётся mock/легаси-пути.
      questionsHtml={attemptMode === "practice" ? null : questionsHtml}
      // P15 — deep-link авто-скролл к вопросу, только practice (в mock проп не
      // передаём: mock ходит iframe-раннером, атомизации тут нет).
      focus={attemptMode === "practice" ? focusNumber : undefined}
      // P2b-2 — номера вопросов с локатором ДО reveal. Практис-reading; для mock/
      // listening проп undefined → кнопка «Where to look?» не рендерится.
      locatable={attemptMode === "practice" && !audioSrc ? locatableRows.map((r) => r.number) : undefined}
    />
  );
}
