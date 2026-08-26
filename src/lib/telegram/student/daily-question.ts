import "server-only";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { answerKey, contentItem, mistakeReview, question } from "@/db/schema";
import { gradeOne, type AnswerMode } from "@/lib/grading/grade";
import { stripHtml } from "@/lib/result/debrief";

/**
 * «Вопрос дня» студенческого бота (G2-1).
 *
 * ГЛАВНОЕ РЕШЕНИЕ: вопрос берётся ИЗ СОБСТВЕННЫХ ОШИБОК юзера (due-очередь
 * mistake_review), а не случайный из каталога. Причины две, и обе жёсткие:
 *
 *  1. Анти-чит (§4.6). Вердикт по вопросу раскрывает правильный ответ. Для теста,
 *     который человек ещё НЕ проходил, это утечка ключа в мессенджер — то самое,
 *     что запрещено на всех остальных путях. Свою разобранную ошибку он уже видел
 *     в review-снимке, ничего нового бот ему не открывает.
 *  2. Смысл. Цель волны — петля «ошибка → повторение → возврат». Случайный вопрос
 *     из каталога этой петли не образует, а сжигает свежий контент.
 *
 * SM-2-расписание бот НЕ двигает намеренно: иначе он тихо съедал бы очередь
 * повторений, и на сайт возвращаться было бы незачем. Ответ в чате — это крючок,
 * закрывает повтор по-прежнему /app/practice/mistakes.
 */

export interface DailyQuestion {
  contentItemId: string;
  questionNumber: number;
  qtype: string;
  /** Текст вопроса без разметки — Telegram не рендерит наш HTML. */
  prompt: string;
  /** Варианты для кнопок; null — вопрос со свободным вводом. */
  options: string[] | null;
  testTitle: string;
}

/** Варианты вопроса из jsonb-поля: только массив строк, всё прочее — «нет вариантов». */
function parseOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const opts = raw.filter((o): o is string => typeof o === "string" && o.trim() !== "");
  return opts.length > 0 ? opts : null;
}

/**
 * Самая просроченная неотработанная ошибка юзера — или null, если повторять нечего.
 * Anti-join mistake_resolution: закрытая «Mark learned» ошибка остаётся строкой в
 * mistake_review, и без вычета бот спрашивал бы то, что человек уже закрыл (та же
 * поправка, что в getMistakesDueSummary).
 */
export async function pickDailyQuestion(userId: string): Promise<DailyQuestion | null> {
  const notResolved = sql`not exists (
    select 1 from mistake_resolution mr
    where mr.user_id = ${mistakeReview.userId}
      and mr.content_item_id = ${mistakeReview.contentItemId}
      and mr.question_number = ${mistakeReview.questionNumber}
  )`;

  const [row] = await db
    .select({
      contentItemId: mistakeReview.contentItemId,
      questionNumber: mistakeReview.questionNumber,
      qtype: mistakeReview.qtype,
      promptHtml: question.promptHtml,
      options: question.options,
      testTitle: contentItem.title,
    })
    .from(mistakeReview)
    .innerJoin(contentItem, eq(contentItem.id, mistakeReview.contentItemId))
    .innerJoin(
      question,
      and(
        eq(question.contentItemId, mistakeReview.contentItemId),
        eq(question.number, mistakeReview.questionNumber),
      ),
    )
    .where(
      and(
        eq(mistakeReview.userId, userId),
        lte(mistakeReview.dueAt, sql`now()`),
        // Снятый с публикации тест в боте не спрашиваем: ссылка «разобрать» из него
        // привела бы в никуда.
        eq(contentItem.status, "published"),
        notResolved,
      ),
    )
    .orderBy(asc(mistakeReview.dueAt))
    .limit(1);

  if (!row) return null;
  return {
    contentItemId: row.contentItemId,
    questionNumber: row.questionNumber,
    qtype: row.qtype,
    prompt: stripHtml(row.promptHtml),
    options: parseOptions(row.options),
    testTitle: row.testTitle,
  };
}

export interface DailyVerdict {
  correct: boolean;
  /** Верный ответ — показываем ПОСЛЕ ответа: это ошибка самого юзера, он её уже
   *  разбирал на сайте, так что ключ здесь не «утекает», а напоминается. */
  expected: string | null;
}

/**
 * Проверка ответа на вопрос дня. Ключ читается owner-path и НИКОГДА не покидает
 * сервер до ответа: в чат уходит только вердикт. Грейдит общий gradeOne — тот же,
 * что экзамен и practice-reveal, чтобы «правильно» значило одно и то же везде.
 * null — вопроса или ключа больше нет (тест удалён/переимпортирован).
 */
export async function checkDailyAnswer(
  contentItemId: string,
  questionNumber: number,
  value: string,
): Promise<DailyVerdict | null> {
  const [row] = await db
    .select({ mode: answerKey.mode, accept: answerKey.accept })
    .from(question)
    .innerJoin(answerKey, eq(answerKey.questionId, question.id))
    .where(and(eq(question.contentItemId, contentItemId), eq(question.number, questionNumber)))
    .limit(1);
  if (!row) return null;

  const accept = Array.isArray(row.accept) ? (row.accept as string[]) : [];
  const correct = gradeOne({ mode: row.mode as AnswerMode, accept }, value);
  return { correct, expected: accept[0] ?? null };
}
