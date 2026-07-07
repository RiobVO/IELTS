/**
 * P9-rich «вариант B» — ЧИСТАЯ деривация открытых ошибок (без БД, тестируется без
 * окружения). В БД материализуются только резолюции (mistake_resolution); открытые
 * ошибки собираются на чтении из review-snapshot попыток + сохранённых ответов
 * (см. getOpenMistakes в ./mistakes). Здесь — только логика дедупа/минус-резолюций/
 * маппинга; I/O нет.
 *
 * accept/mode вопроса используются ЛОКАЛЬНО (gradeOne) и НЕ попадают в результат —
 * наружу уходят лишь безопасные поля (инвариант 2: без accept/explanation/evidence).
 */
import { gradeOne, type AnswerMode } from "@/lib/grading/grade";

/** Ключ вопроса из review-snapshot (D3), достаточный для gradeOne + ярлыка. */
export interface SnapshotKeyQuestion {
  number: number;
  qtype: string;
  mode: AnswerMode;
  /** правильные/принимаемые значения (answer_key.accept на момент сдачи) — server-only */
  accept: string[];
}

/** Сданная попытка + её review-snapshot + сохранённые ответы (вход деривации). */
export interface AttemptForMistakes {
  attemptId: string;
  contentItemId: string;
  title: string;
  section: string;
  /** content_item.runner_html IS NOT NULL — href карточки по каталожному правилу. */
  hasRunner: boolean;
  submittedAt: Date;
  answers: Record<string, string | string[] | null>;
  questions: SnapshotKeyQuestion[];
}

/** Резолюция «ошибка отработана» — ключ вычитания из открытого списка. */
export interface ResolutionKey {
  contentItemId: string;
  questionNumber: number;
  /** Момент «Mark learned»: резолюция гасит только попытки, сданные ДО неё. */
  resolvedAt: Date;
}

/**
 * Открытая ошибка — ТОЛЬКО безопасные для клиента поля (инвариант 2). Ни accept, ни
 * explanation, ни evidence: правильный ответ пользователь смотрит через существующий
 * practice-reveal, не через этот список.
 */
export interface OpenMistake {
  contentItemId: string;
  title: string;
  section: string;
  /** href по каталожному правилу: has_runner → диспетчер /app/exam, иначе /app/reading. */
  hasRunner: boolean;
  questionNumber: number;
  qtype: string;
  attemptId: string;
  submittedAt: Date;
}

const keyOf = (contentItemId: string, questionNumber: number): string =>
  `${contentItemId}:${questionNumber}`;

/**
 * Собрать открытые ошибки. Контракт «вариант B»:
 *  - дедуп по (content_item, question) — берём САМУЮ СВЕЖУЮ попытку с этим вопросом;
 *    её вердикт авторитетен (исправил в свежей попытке → уже не ошибка, даже если
 *    старая попытка была неверной);
 *  - ошибка = !gradeOne(вопрос, ответ) — та же семантика, что submit-грейдинг
 *    (неотвеченный вопрос неверен, как в grade());
 *  - вычитаем резолюции (mistake_resolution), но ТОЛЬКО сделанные ПОСЛЕ попытки
 *    (resolved_at >= submitted_at): «отметил learned → снова ошибся» переоткрывает
 *    ошибку, а резолюция, созданная впрок (forged-вызов экшена до попытки), инертна;
 *  - порядок стабильный: свежие попытки сверху, внутри — в порядке вопросов снапшота.
 * Пагинация (limit/offset) — на вызывающей стороне (getOpenMistakes).
 */
export function deriveOpenMistakes(
  attempts: AttemptForMistakes[],
  resolutions: ResolutionKey[],
): OpenMistake[] {
  // key → resolved_at (ms). Unique(user, content, number) в БД ⇒ максимум одна
  // резолюция на ключ; страховочно берём самую позднюю.
  const resolved = new Map<string, number>();
  for (const r of resolutions) {
    const k = keyOf(r.contentItemId, r.questionNumber);
    const t = r.resolvedAt.getTime();
    const prev = resolved.get(k);
    if (prev === undefined || t > prev) resolved.set(k, t);
  }
  // Свежие сверху. Array.prototype.sort стабилен (ES2019+), поэтому порядок вопросов
  // внутри одной попытки сохраняется как в снапшоте.
  const ordered = [...attempts].sort(
    (a, b) => b.submittedAt.getTime() - a.submittedAt.getTime(),
  );

  const seen = new Set<string>();
  const out: OpenMistake[] = [];
  for (const att of ordered) {
    for (const q of att.questions) {
      const k = keyOf(att.contentItemId, q.number);
      // Первое появление = самая свежая попытка с этим вопросом → её вердикт решает.
      // Помечаем seen СРАЗУ, чтобы старая (неверная) попытка не переоткрыла ошибку,
      // которую в свежей попытке исправили.
      if (seen.has(k)) continue;
      seen.add(k);
      // Отработано ПОСЛЕ этой попытки → погашено; резолюция старее попытки не гасит
      // (re-fail после «Mark learned» переоткрывается, forged-впрок — инертен).
      const resolvedAtMs = resolved.get(k);
      if (resolvedAtMs !== undefined && resolvedAtMs >= att.submittedAt.getTime()) continue;
      const given = att.answers[String(q.number)] ?? null;
      if (gradeOne(q, given)) continue; // в свежей попытке верно → не ошибка
      out.push({
        contentItemId: att.contentItemId,
        title: att.title,
        section: att.section,
        hasRunner: att.hasRunner,
        questionNumber: q.number,
        qtype: q.qtype,
        attemptId: att.attemptId,
        submittedAt: att.submittedAt,
      });
    }
  }
  return out;
}
