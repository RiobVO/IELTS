import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { answerKey, contentItem, passage, question } from "@/db/schema";
import { cronSecret, l1FeatureEnabled, publicSiteUrl } from "@/env";
import { normalizeEvidence } from "@/lib/exam/review-snapshot";

/** Персист режет каждое объяснение до этой длины — страховка от аномального ответа. */
const MAX_EXPLANATION_CHARS = 600;

// Атомарный claim (mirror of claimForEvaluation, src/lib/writing/store.ts): только
// НЕ-'generating' строка может начать новый прогон, поэтому конкурентные триггеры
// (admin upload + telegram + regenerate) безопасны — второй вызов теряет claim.
export async function claimL1(contentItemId: string): Promise<boolean> {
  const rows = await db
    .update(contentItem)
    .set({ l1Status: "generating" })
    .where(and(eq(contentItem.id, contentItemId), ne(contentItem.l1Status, "generating")))
    .returning({ id: contentItem.id });
  return rows.length === 1;
}

// Status-guarded (mirror of markFailed/persistFeedback в writing/store.ts): только
// ещё-'generating' строку можно перевести в done/failed. Без гварда параллельный
// reset (regenerateL1 → 'pending') мог бы быть перетёрт более медленным прогоном.
export async function markL1Status(contentItemId: string, status: "done" | "failed"): Promise<void> {
  await db
    .update(contentItem)
    .set({ l1Status: status })
    .where(and(eq(contentItem.id, contentItemId), eq(contentItem.l1Status, "generating")));
}

export interface L1LoadedQuestion {
  questionId: string;
  number: number;
  qtype: string;
  promptHtml: string;
  options: string[] | null;
  /** answer_key.accept — jsonb, нормализован в string[] (парсер может писать не-массив). */
  accept: string[];
  explanationEn: string | null;
  /** answer_key.evidence.snippet — цитата из текста, основной якорь для listening. */
  evidenceSnippet: string | null;
}

export interface L1LoadedPassage {
  passageId: string;
  bodyHtml: string;
  questions: L1LoadedQuestion[];
}

function normalizeAccept(accept: unknown): string[] {
  return Array.isArray(accept) ? (accept as string[]) : [];
}

// Тот же alias-нормализатор, что review-snapshot.ts: часть импортов кладёт
// evidence как {part, text}, не {para, snippet} — без него промт лишался бы
// якоря-цитаты у части тестов, хотя evidence реально был в БД.
function extractEvidenceSnippet(evidence: unknown): string | null {
  return normalizeEvidence(evidence)?.snippet ?? null;
}

// Загружает пассажи + вопросы + ключ (owner-путём — answer_key залочена RLS-ом) для
// одного теста, сгруппированные по пассажу — единица генерации (generateL1ForPassage
// вызывается на пассаж целиком, чтобы модель видела текст один раз).
export async function loadTestForL1(contentItemId: string): Promise<L1LoadedPassage[]> {
  const rows = await db
    .select({
      passageId: passage.id,
      bodyHtml: passage.bodyHtml,
      questionId: question.id,
      number: question.number,
      qtype: question.qtype,
      promptHtml: question.promptHtml,
      options: question.options,
      accept: answerKey.accept,
      explanationEn: answerKey.explanation,
      evidence: answerKey.evidence,
    })
    .from(passage)
    .innerJoin(question, eq(question.passageId, passage.id))
    .leftJoin(answerKey, eq(answerKey.questionId, question.id))
    .where(eq(passage.contentItemId, contentItemId))
    .orderBy(passage.order, question.order);

  const byPassage = new Map<string, L1LoadedPassage>();
  for (const r of rows) {
    let p = byPassage.get(r.passageId);
    if (!p) {
      p = { passageId: r.passageId, bodyHtml: r.bodyHtml, questions: [] };
      byPassage.set(r.passageId, p);
    }
    p.questions.push({
      questionId: r.questionId,
      number: r.number,
      qtype: r.qtype,
      promptHtml: r.promptHtml,
      options: Array.isArray(r.options) ? (r.options as string[]) : null,
      accept: normalizeAccept(r.accept),
      explanationEn: r.explanationEn,
      evidenceSnippet: extractEvidenceSnippet(r.evidence),
    });
  }
  return [...byPassage.values()];
}

// Пишет explanation_ru по questionId (UPDATE per row — batch мал, ~40 вопросов на
// Full-тест). Обрезка до MAX_EXPLANATION_CHARS — страховка персиста от аномально
// длинного ответа модели, отдельно от responseSchema. Возвращает число успешных
// записей (route считает test 'done' только если persisted >= 1).
export async function persistL1(
  items: { questionId: string; explanationRu: string }[],
): Promise<number> {
  if (items.length === 0) return 0;
  const results = await Promise.all(
    items.map((i) =>
      db
        .update(answerKey)
        .set({ explanationRu: i.explanationRu.slice(0, MAX_EXPLANATION_CHARS) })
        .where(eq(answerKey.questionId, i.questionId))
        .returning({ id: answerKey.id }),
    ),
  );
  return results.reduce((n, r) => n + r.length, 0);
}

// Fire-and-forget trigger (mirror of triggerEvaluate, src/lib/writing/store.ts) —
// idempotent via claimL1, so a re-fire (lost-trigger re-kick, or a second caller
// racing the same import) is safe. Unlike triggerEvaluate this does NOT wrap itself
// in after() — callers that need deferred execution (admin upload) wrap it
// themselves; callers already running inside deferred work (telegram) or that must
// kick off before returning (regenerateL1 action) await it directly.
export async function triggerL1Generation(contentItemId: string): Promise<void> {
  if (!l1FeatureEnabled()) return; // фича выключена — no-op
  const origin = publicSiteUrl();
  const secret = cronSecret();
  if (!origin || !secret) return; // defensive; l1FeatureEnabled() already guarantees both
  try {
    await fetch(`${origin}/api/content/generate-l1`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ contentItemId }),
    });
  } catch (e) {
    console.error("triggerL1Generation fetch failed", contentItemId, e);
  }
}
