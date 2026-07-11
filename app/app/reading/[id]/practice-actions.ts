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

import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  answerKey,
  attempt,
  attemptReviewSnapshot,
  mistakeResolution,
  mistakeReview,
  question,
} from "@/db/schema";
import { getUser } from "@/lib/auth";
import { gradeOne, type AnswerMode } from "@/lib/grading/grade";
import { isUuid } from "@/lib/uuid";
import { reviewCard, type Grade } from "@/lib/vocab/srs";

/** Раскрытие одного вопроса (P7). evidence сведён к контракту {para?, snippet?}. */
export interface RevealResult {
  accept: string[];
  explanation: string | null;
  /** RU-объяснение (L1-слой, 0050) — тот же гейт/путь, что explanation. */
  explanationRu: string | null;
  evidence: { para?: string; snippet?: string } | null;
}

/** Ключ ОДНОГО вопроса practice-попытки после всех гейтов (внутр., не сериализуется). */
interface PracticeKeyRow {
  /** id владельца попытки (из сессии) — для owner-path записи SR-стейта. */
  userId: string;
  /** тест попытки — ключ (user, content, number) SR-строки mistake_review. */
  contentItemId: string;
  mode: AnswerMode;
  /** qtype нужен серверному гейту locateEvidence (para≈ответ для matching-типов). */
  qtype: string;
  accept: string[];
  explanation: string | null;
  explanationRu: string | null;
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
      explanationRu: answerKey.explanationRu,
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
    userId: user.id,
    contentItemId: att.contentItemId,
    mode: row.mode,
    qtype: row.qtype,
    accept: Array.isArray(row.accept) ? (row.accept as string[]) : [],
    explanation: row.explanation ?? null,
    explanationRu: row.explanationRu ?? null,
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
    // Только para (не snippet) — normalizeEvidence требует непустой snippet, что
    // отсекло бы законный кейс «para/part есть, snippet/text пуст» для локатора,
    // которому snippet вообще не нужен. Тот же alias part→para, что в normalizeEvidence.
    const raw = key.evidence as { para?: unknown; part?: unknown } | null;
    const para = raw?.para ?? raw?.part;
    const paraStr = typeof para === "string" ? para : typeof para === "number" ? String(para) : "";
    return paraStr ? { para: paraStr } : null;
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

    // part/text — тот же ключевой alias, что normalizeEvidence (review-snapshot.ts):
    // часть импортированных файлов кладёт evidence как {part, text}, не {para, snippet}.
    // Тут держим оригинальную «либо-либо»-семантику (para ИЛИ snippet), не строгий
    // normalizeEvidence — RevealResult.evidence оба поля делает опциональными нарочно.
    const raw = key.evidence as { para?: unknown; part?: unknown; snippet?: unknown; text?: unknown } | null;
    let evidence: RevealResult["evidence"] = null;
    if (raw && typeof raw === "object") {
      const paraRaw = raw.para ?? raw.part;
      const snippetRaw = raw.snippet ?? raw.text;
      const e: { para?: string; snippet?: string } = {};
      if (typeof paraRaw === "string" && paraRaw) e.para = paraRaw;
      else if (typeof paraRaw === "number") e.para = String(paraRaw);
      if (typeof snippetRaw === "string" && snippetRaw) e.snippet = snippetRaw;
      if (e.para || e.snippet) evidence = e;
    }

    return { accept: key.accept, explanation: key.explanation, explanationRu: key.explanationRu, evidence };
  } catch (e) {
    console.error("revealQuestion failed", e);
    return null;
  }
}

/**
 * Порог «выученности»: серия из стольких «good» подряд авто-закрывает ошибку (T7 —
 * best-effort запись в mistake_resolution, кормит W2-5-бейджи). 3 = пройдены оба
 * первых шага SM-2 (1д → 3д) и карта вышла на множительный интервал.
 */
const GRADUATE_REPETITIONS = 3;

/** Ровно те поля snapshot.questions (D3), которых достаточно для gradeOne одного вопроса. */
interface StoredSnapshotQuestion {
  number?: unknown;
  mode?: unknown;
  accept?: unknown;
}

/**
 * ФИКС «SR-строка только для реальных ошибок»: reviewMistake публичен на ЛЮБОЙ вопрос
 * practice-попытки (гейт loadPracticeKey — owner∧in_progress∧practice, но НЕ «юзер тут
 * ошибся») — без этой проверки можно было бы накрутить закрытие вопросов, которые юзер
 * никогда не проваливал. Вызывается ТОЛЬКО на пути создания SR-строки (state ещё нет) —
 * не горячий путь. Берём свежайшую СДАННУЮ попытку этого юзера по этому тесту (кроме
 * текущей practice-попытки — она ещё in_progress и снапшота не имеет), её
 * attempt_review_snapshot + answers (та же выборка, что getOpenMistakes) и грейдим ТОЛЬКО
 * запрошенный номер. Нет подходящей попытки/вопроса в снапшоте → трактуем как
 * «не подтверждено» (безопаснее, чем доверять отсутствию данных).
 */
async function wasQuestionMissed(
  userId: string,
  contentItemId: string,
  excludeAttemptId: string,
  questionNumber: number,
): Promise<boolean> {
  const [row] = await db
    .select({
      answers: attempt.answers,
      snapshot: attemptReviewSnapshot.snapshot,
    })
    .from(attempt)
    .innerJoin(attemptReviewSnapshot, eq(attemptReviewSnapshot.attemptId, attempt.id))
    .where(
      and(
        eq(attempt.userId, userId),
        eq(attempt.contentItemId, contentItemId),
        eq(attempt.status, "submitted"),
        ne(attempt.id, excludeAttemptId),
      ),
    )
    .orderBy(desc(attempt.submittedAt))
    .limit(1);
  if (!row) return false;

  const snap = row.snapshot as { questions?: StoredSnapshotQuestion[] } | null;
  const q = snap?.questions?.find((item) => item.number === questionNumber);
  if (!q || typeof q.mode !== "string") return false;

  const answers = (row.answers as Record<string, string | string[] | null>) ?? {};
  const given = answers[String(questionNumber)] ?? null;
  return !gradeOne(
    { mode: q.mode as AnswerMode, accept: Array.isArray(q.accept) ? (q.accept as string[]) : [] },
    given,
  );
}

/**
 * SR-ревью ошибки из очереди (учебная петля, BRIEF §12.3 шаг 2). Тот же гейт, что у
 * checkAnswer/reveal (loadPracticeKey: owner ∧ in_progress ∧ practice в WHERE) — mock/
 * чужая/сданная попытка физически не вернёт строку → null. Сервер — единственный судья
 * SM-2: клиентскому verdict НЕ доверяем, грейдим сами (gradeOne), grade = good|again
 * (easy к ошибкам неприменим). По образцу reviewSavedWord: читаем SR-стейт owner-path →
 * общий reviewCard (не дублируя формулу) → UPSERT owner-path. Клиенту — минимум
 * { correct, dueAt } (ни ключа, ни SM-2-полей). Best-effort → null при сбое/провале гейта.
 */
export async function reviewMistake(
  attemptId: string,
  questionNumber: number,
  value: string | string[],
): Promise<{ correct: boolean; dueAt: string } | null> {
  try {
    const key = await loadPracticeKey(attemptId, questionNumber);
    if (!key) return null;

    // Судит сервер: verdict клиента игнорируем. easy не используется (гейт isNew к
    // ошибкам неприменим) — только good (верно) / again (снова неверно).
    const correct = gradeOne(key, value);
    const grade: Grade = correct ? "good" : "again";
    const now = new Date();

    // Текущий SR-стейт owner-path (WHERE user_id ∧ content_item_id ∧ question_number).
    const [state] = await db
      .select({
        ease: mistakeReview.ease,
        intervalDays: mistakeReview.intervalDays,
        repetitions: mistakeReview.repetitions,
        lapses: mistakeReview.lapses,
        dueAt: mistakeReview.dueAt,
      })
      .from(mistakeReview)
      .where(
        and(
          eq(mistakeReview.userId, key.userId),
          eq(mistakeReview.contentItemId, key.contentItemId),
          eq(mistakeReview.questionNumber, questionNumber),
        ),
      )
      .limit(1);

    // ГЕЙТ против спам-градуации: строка УЖЕ существует, её плановый срок ещё не
    // наступил, и досрочный повтор ВЕРНЫЙ — не двигаем лестницу (ничего не пишем).
    // Классическое SR-поведение: ранний "good" не удивляет систему, карта и так
    // считается известной, интервал/серия остаются как есть. Без этого гейта 3 клика
    // Check за минуту двигали бы SM-2 три раза подряд и давали мгновенную graduation.
    // "again" (провал) НЕ гейтуется — досрочная ошибка ценный сигнал, всегда применяется.
    if (state && grade === "good" && state.dueAt.getTime() > now.getTime()) {
      return { correct, dueAt: state.dueAt.toISOString() };
    }

    // ГЕЙТ «SR-строка только для реальных ошибок»: строки ЕЩЁ НЕТ — значит сейчас её
    // создание. Публичный экшен доступен на любой вопрос practice-попытки, поэтому перед
    // первым созданием подтверждаем факт ошибки по последней сданной попытке (см.
    // wasQuestionMissed). Если не подтвердилось — no-op: ни строки, ни graduation.
    if (!state) {
      const wasWrong = await wasQuestionMissed(key.userId, key.contentItemId, attemptId, questionNumber);
      if (!wasWrong) {
        return { correct, dueAt: now.toISOString() };
      }
    }

    const { state: next, dueAt } = reviewCard(state ?? null, grade, now);

    // UPSERT owner-path. qtype авторитетен с сервера (из loadPracticeKey), пишется
    // только при INSERT (снимок первого ревью, как mistake_resolution) — на конфликте
    // НЕ трогаем. dueAt/now идут через query-builder (параметризуются драйвером), НЕ в
    // raw sql``-шаблоне — иначе Date роняет прод (pgbouncer, prepare:false).
    await db
      .insert(mistakeReview)
      .values({
        userId: key.userId,
        contentItemId: key.contentItemId,
        questionNumber,
        qtype: key.qtype,
        ease: next.ease,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        lapses: next.lapses,
        dueAt,
        lastReviewedAt: now,
      })
      .onConflictDoUpdate({
        target: [mistakeReview.userId, mistakeReview.contentItemId, mistakeReview.questionNumber],
        set: {
          ease: next.ease,
          intervalDays: next.intervalDays,
          repetitions: next.repetitions,
          lapses: next.lapses,
          dueAt,
          lastReviewedAt: now,
        },
      });

    // T7 — graduation: серия «good» достигла порога → авто-закрытие ошибки (кормит
    // W2-5-бейджи через mistake_resolution). Best-effort: сбой этой записи НЕ роняет
    // ревью (как соседние best-effort в post-submit pipeline). ON CONFLICT DO UPDATE
    // resolved_at: переоткрытая ошибка (новая wrong-попытка после старого закрытия)
    // должна перегасить свежим resolved_at — DO NOTHING оставлял бы старую дату и
    // карточка зависала бы открытой навсегда (resolved_at >= submitted_at не выполнялось
    // бы для новой попытки). qtype на конфликте НЕ трогаем — тот же авторитетный снимок.
    if (next.repetitions >= GRADUATE_REPETITIONS) {
      try {
        await db
          .insert(mistakeResolution)
          .values({
            userId: key.userId,
            contentItemId: key.contentItemId,
            questionNumber,
            qtype: key.qtype,
          })
          .onConflictDoUpdate({
            target: [mistakeResolution.userId, mistakeResolution.contentItemId, mistakeResolution.questionNumber],
            set: { resolvedAt: now },
          });
      } catch (e) {
        console.error("reviewMistake graduation insert failed", e);
      }
    }

    return { correct, dueAt: dueAt.toISOString() };
  } catch (e) {
    console.error("reviewMistake failed", e);
    return null;
  }
}
