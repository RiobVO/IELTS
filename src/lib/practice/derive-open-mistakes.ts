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
 * SR-строка mistake_review (SM-2-расписание одной ошибки) — вход due-статуса. Только
 * несекретные поля: расписание, не ключ ответа.
 */
export interface MistakeReviewRow {
  contentItemId: string;
  questionNumber: number;
  /** Плановый срок следующего повтора (SM-2). */
  dueAt: Date;
  /** Текущий интервал повтора в днях (для пометки «next in Xd»). */
  intervalDays: number;
  /** Момент последнего SR-ревью; null — если строка почему-то без ревью. */
  lastReviewedAt: Date | null;
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
  /** Плановый срок повтора из mistake_review; null — SR-строки ещё нет (повтор сейчас). */
  dueAt: Date | null;
  /** Пора повторять: нет расписания, срок прошёл, либо расписание протухло (re-open). */
  isDue: boolean;
  /** Текущий SM-2-интервал в днях (0 без строки) — для пометки «next in Xd». */
  intervalDays: number;
}

const keyOf = (contentItemId: string, questionNumber: number): string =>
  `${contentItemId}:${questionNumber}`;

/**
 * Собрать открытые ошибки. Контракт «вариант B» + SR-расписание (mistake_review):
 *  - дедуп по (content_item, question) — берём САМУЮ СВЕЖУЮ попытку с этим вопросом;
 *    её вердикт авторитетен (исправил в свежей попытке → уже не ошибка, даже если
 *    старая попытка была неверной);
 *  - ошибка = !gradeOne(вопрос, ответ) — та же семантика, что submit-грейдинг
 *    (неотвеченный вопрос неверен, как в grade());
 *  - вычитаем резолюции (mistake_resolution), но ТОЛЬКО сделанные ПОСЛЕ попытки
 *    (resolved_at >= submitted_at): «отметил learned → снова ошибся» переоткрывает
 *    ошибку, а резолюция, созданная впрок (forged-вызов экшена до попытки), инертна;
 *  - SR-статус (isDue) поверх каждой открытой ошибки: нет SR-строки → due сейчас;
 *    due_at <= now → due; wrong-попытка ПОЗЖЕ last_reviewed_at → расписание протухло
 *    → due (зеркало re-open-правила резолюций); иначе scheduled (isDue false);
 *  - порядок: due-первые (по due_at asc, null первыми), затем scheduled; в равных —
 *    стабильно сохраняется исходный порядок (свежие попытки сверху).
 * `now` — параметром ради детерминизма (как в reviewCard). Пагинация (limit/offset) —
 * на вызывающей стороне (getOpenMistakes).
 */
export function deriveOpenMistakes(
  attempts: AttemptForMistakes[],
  resolutions: ResolutionKey[],
  reviews: MistakeReviewRow[] = [],
  now: Date = new Date(),
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
  // key → SR-строка. Unique(user, content, number) ⇒ максимум одна строка на ключ.
  const reviewByKey = new Map<string, MistakeReviewRow>();
  for (const r of reviews) reviewByKey.set(keyOf(r.contentItemId, r.questionNumber), r);

  // Свежие сверху. Array.prototype.sort стабилен (ES2019+), поэтому порядок вопросов
  // внутри одной попытки сохраняется как в снапшоте.
  const ordered = [...attempts].sort(
    (a, b) => b.submittedAt.getTime() - a.submittedAt.getTime(),
  );

  const nowMs = now.getTime();
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

      // SR-статус поверх открытой ошибки. att здесь — самая свежая (и неверная)
      // попытка с этим вопросом, её submittedAt = момент последней ошибки.
      const row = reviewByKey.get(k);
      let dueAt: Date | null;
      let intervalDays: number;
      let isDue: boolean;
      if (!row) {
        // Расписания ещё нет → ошибку нужно повторять сразу.
        dueAt = null;
        intervalDays = 0;
        isDue = true;
      } else {
        dueAt = row.dueAt;
        intervalDays = row.intervalDays;
        const overdue = row.dueAt.getTime() <= nowMs;
        // Ревью старее последней ошибки → расписание невалидно (снова ошибся после
        // повтора) — зеркало резолюционного re-open (resolved_at >= submitted_at).
        const staleSchedule =
          row.lastReviewedAt == null || att.submittedAt.getTime() > row.lastReviewedAt.getTime();
        isDue = overdue || staleSchedule;
      }

      out.push({
        contentItemId: att.contentItemId,
        title: att.title,
        section: att.section,
        hasRunner: att.hasRunner,
        questionNumber: q.number,
        qtype: q.qtype,
        attemptId: att.attemptId,
        submittedAt: att.submittedAt,
        dueAt,
        isDue,
        intervalDays,
      });
    }
  }

  // Due-первые; внутри группы — по due_at asc (null раньше любого времени). Sort
  // стабилен → при равных ключах исходный порядок (свежесть попыток) сохраняется.
  out.sort((a, b) => {
    const ra = a.isDue ? 0 : 1;
    const rb = b.isDue ? 0 : 1;
    if (ra !== rb) return ra - rb;
    const ta = a.dueAt === null ? -Infinity : a.dueAt.getTime();
    const tb = b.dueAt === null ? -Infinity : b.dueAt.getTime();
    return ta - tb;
  });
  return out;
}
