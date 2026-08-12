"use server";

/**
 * Practice-only server actions (P6/P7): мгновенная проверка ответа и раскрытие
 * правильного ответа/объяснения/evidence ДО сдачи. Это осознанный продуктовый ход,
 * а не дыра: practice-попытки НИКОГДА не рейтингуются (shouldRateAttempt) и не идут в
 * daily-cap (§4.6 / P0), а разбор после сдачи и так бесплатен (REVIEW_OPEN). Критично
 * лишь, что раскрытие НЕВОЗМОЖНО для mock и для чужих/сданных попыток — это гарантирует
 * общий гейт: owner ∧ status='in_progress' ∧ mode='practice' стоит прямо в WHERE, так
 * что mock/чужая/сданная попытка не вернёт строку → null (физически не проходит).
 *
 * answer_key НИКОГДА не сериализуется целиком: оба экшена читают ключ owner-path
 * (Drizzle bypass RLS) ТОЛЬКО для ОДНОГО запрошенного вопроса этой попытки. checkAnswer
 * отдаёт клиенту лишь boolean; revealQuestion — accept/explanation/evidence одного
 * вопроса. Оба best-effort: любой сбой/невалидный вход → null (в клиент не бросаем).
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { answerKey, attempt, question } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { gradeOne, type AnswerMode } from "@/lib/grading/grade";
import { isUuid } from "@/lib/uuid";

/** Раскрытие одного вопроса (P7). evidence сведён к контракту {para?, snippet?}. */
export interface RevealResult {
  accept: string[];
  explanation: string | null;
  evidence: { para?: string; snippet?: string } | null;
}

/** Ключ ОДНОГО вопроса practice-попытки после всех гейтов (внутр., не сериализуется). */
interface PracticeKeyRow {
  mode: AnswerMode;
  /** qtype нужен серверному гейту locateEvidence (para≈ответ для matching-типов). */
  qtype: string;
  accept: string[];
  explanation: string | null;
  evidence: unknown;
}

/**
 * Общий гейт обоих экшенов (порядок как в submitAttempt): auth → формат id →
 * owner+in_progress+practice попытка → ключ ОДНОГО вопроса (join question⋈answer_key
 * по content_item_id + number). Возвращает null при любом провале гейта или отсутствии
 * строки. НЕ экспортируется (не server action) — только внутренний контур.
 */
async function loadPracticeKey(
  attemptId: string,
  questionNumber: number,
): Promise<PracticeKeyRow | null> {
  const user = await getUser();
  if (!user) return null;
  // client-reachable: кривой uuid не должен ронять uuid-колонку (22P02) — screen заранее.
  if (!isUuid(attemptId)) return null;
  if (!Number.isInteger(questionNumber)) return null;

  // Owner ∧ in_progress ∧ practice — прямо в WHERE. Чужая/сданная/mock-попытка не
  // вернёт строку → null; проверка/раскрытие для mock физически невозможны.
  const [att] = await db
    .select({ contentItemId: attempt.contentItemId })
    .from(attempt)
    .where(
      and(
        eq(attempt.id, attemptId),
        eq(attempt.userId, user.id),
        eq(attempt.status, "in_progress"),
        eq(attempt.mode, "practice"),
      ),
    );
  if (!att) return null;

  // Ключ ТОЛЬКО этого вопроса (owner-path bypass RLS, но answer_key целиком в клиент
  // не уходит — читаем ровно одну строку теста запрошенной попытки).
  const [row] = await db
    .select({
      mode: answerKey.mode,
      qtype: question.qtype,
      accept: answerKey.accept,
      explanation: answerKey.explanation,
      evidence: answerKey.evidence,
    })
    .from(question)
    .innerJoin(answerKey, eq(answerKey.questionId, question.id))
    .where(
      and(
        eq(question.contentItemId, att.contentItemId),
        eq(question.number, questionNumber),
      ),
    )
    .limit(1);
  if (!row) return null;

  return {
    mode: row.mode,
    qtype: row.qtype,
    accept: Array.isArray(row.accept) ? (row.accept as string[]) : [],
    explanation: row.explanation ?? null,
    evidence: row.evidence,
  };
}

/**
 * qtype, где номер/буква абзаца ≈ САМ ответ: локатор ДО reveal раскрыл бы ключ в
 * обход (P2b-2). matching_info — вопрос буквально «в каком абзаце эта информация»
 * (para = ответ); matching_headings — заголовок абзаца и есть выбираемый ответ. Для
 * них locateEvidence ВСЕГДА null. Для tfng/completion/mcq знание абзаца лишь
 * подсказывает «где смотреть», но не даёт ответ — там локатор допустим.
 */
const LOCATE_BLOCKED_QTYPES = new Set(["matching_info", "matching_headings"]);

/**
 * P2b-2 — локатор ДО reveal («Where to look»). Тот же гейт, что у revealQuestion
 * (owner ∧ in_progress ∧ practice в WHERE через loadPracticeKey), но отдаёт МИНИМУМ:
 * ОДНО поле `para` ОДНОГО вопроса — куда смотреть, не что отвечать. Строго слабее
 * P7-reveal (accept/explanation/snippet не сериализуются). Серверный qtype-гейт
 * (см. LOCATE_BLOCKED_QTYPES) и отсутствие evidence.para → null. Best-effort → null.
 */
export async function locateEvidence(
  attemptId: string,
  questionNumber: number,
): Promise<{ para: string } | null> {
  try {
    const key = await loadPracticeKey(attemptId, questionNumber);
    if (!key) return null;
    // qtype-гейт на СЕРВЕРЕ: для matching_info/matching_headings para ≡ ответ.
    if (LOCATE_BLOCKED_QTYPES.has(key.qtype)) return null;
    const raw = key.evidence as { para?: unknown } | null;
    if (raw && typeof raw === "object" && typeof raw.para === "string" && raw.para) {
      return { para: raw.para };
    }
    return null;
  } catch (e) {
    console.error("locateEvidence failed", e);
    return null;
  }
}

/**
 * P6 — мгновенная проверка. Возвращает ТОЛЬКО boolean (никаких «почти» или канонических
 * форм). value client-reachable (string|string[]); нормализацию и матч делает gradeOne —
 * ровно та же логика, что и submit-грейдинг. Best-effort → null при сбое/провале гейта.
 */
export async function checkAnswer(
  attemptId: string,
  questionNumber: number,
  value: string | string[],
): Promise<{ correct: boolean } | null> {
  try {
    const key = await loadPracticeKey(attemptId, questionNumber);
    if (!key) return null;
    return { correct: gradeOne(key, value) };
  } catch (e) {
    console.error("checkAnswer failed", e);
    return null;
  }
}

/**
 * P7 — раскрытие правильного ответа/объяснения/evidence ОДНОГО вопроса. evidence
 * сведён к {para?, snippet?} (только строковые поля, пустой → null). Best-effort → null.
 */
export async function revealQuestion(
  attemptId: string,
  questionNumber: number,
): Promise<RevealResult | null> {
  try {
    const key = await loadPracticeKey(attemptId, questionNumber);
    if (!key) return null;

    const raw = key.evidence as { para?: unknown; snippet?: unknown } | null;
    let evidence: RevealResult["evidence"] = null;
    if (raw && typeof raw === "object") {
      const e: { para?: string; snippet?: string } = {};
      if (typeof raw.para === "string" && raw.para) e.para = raw.para;
      if (typeof raw.snippet === "string" && raw.snippet) e.snippet = raw.snippet;
      if (e.para || e.snippet) evidence = e;
    }

    return { accept: key.accept, explanation: key.explanation, evidence };
  } catch (e) {
    console.error("revealQuestion failed", e);
    return null;
  }
}
