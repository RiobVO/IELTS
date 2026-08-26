import "server-only";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { answerKey, contentItem, question } from "@/db/schema";
import { gradeOne, type AnswerMode } from "@/lib/grading/grade";
import { getOpenMistakes } from "@/lib/practice/mistakes";
import { stripHtml } from "@/lib/result/debrief";
import { isChatAnswerable } from "./chat-answerable";

/**
 * «Вопрос дня» студенческого бота (G2-1).
 *
 * ГЛАВНОЕ РЕШЕНИЕ: вопрос берётся ИЗ СОБСТВЕННЫХ ОШИБОК юзера, а не случайный из
 * каталога. Причины две, и обе жёсткие:
 *
 *  1. Анти-чит (§4.6). Вердикт по вопросу раскрывает правильный ответ. Для теста,
 *     который человек ещё НЕ сдавал, это утечка ключа в мессенджер — то самое,
 *     что запрещено на всех остальных путях. По СВОЕЙ сданной попытке разбор с
 *     ответами ему и так открыт на /result, бот не открывает ничего нового.
 *  2. Смысл. Цель волны — петля «ошибка → повторение → возврат». Случайный вопрос
 *     из каталога этой петли не образует, а сжигает свежий контент.
 *
 * ОТКУДА ОШИБКИ. Из сданных попыток (getOpenMistakes: деривация из attempt +
 * attempt_review_snapshot), а НЕ из таблицы mistake_review. Раньше бот читал
 * mistake_review напрямую — но она наполняется только когда человек РУКАМИ разбирает
 * ошибки на сайте, и на проде в ней лежало 2 строки от одного юзера при 75 сданных
 * попытках от двенадцати. Для всех, кроме одного, бот был пуст: писать новичку было
 * не о чем ровно до того момента, как он сам дойдёт до экрана разбора. Теперь
 * источник — сама попытка, а mistake_review остаётся тем, чем и была: SM-2-
 * расписанием (getOpenMistakes учитывает его в isDue, поэтому повторённое на сайте
 * бот не переспрашивает раньше срока).
 *
 * SM-2-расписание бот НЕ двигает намеренно: иначе он тихо съедал бы очередь
 * повторений, и на сайт возвращаться было бы незачем. Ответ в чате — это крючок,
 * закрывает повтор по-прежнему /app/practice/mistakes.
 */

/** Вариант ответа: `label` человеку на кнопку, `value` — то, что грейдится. */
export interface DailyQuestionOption {
  label: string;
  value: string;
}

export interface DailyQuestion {
  contentItemId: string;
  questionNumber: number;
  qtype: string;
  /** Текст вопроса без разметки — Telegram не рендерит наш HTML. */
  prompt: string;
  /** Варианты для кнопок; null — вопрос со свободным вводом. */
  options: DailyQuestionOption[] | null;
  testTitle: string;
}

/**
 * Варианты из jsonb-поля `question.options`. Формат исторически ДВОЯКИЙ: импорт
 * пишет объекты `{label, value}` (matching_headings хранит «i» отдельно от текста
 * заголовка), а часть источников — простые строки. Живая проверка на проде поймала
 * именно это: разбор, знавший только строки, молча отдавал null, и вопрос с выбором
 * превращался в «угадай, что напечатать» (для matching_headings — угадай римскую
 * цифру). Поэтому принимаем обе формы, а несовпадающее считаем «нет вариантов».
 */
export function parseOptions(raw: unknown): DailyQuestionOption[] | null {
  if (!Array.isArray(raw)) return null;
  const opts: DailyQuestionOption[] = [];
  for (const o of raw) {
    if (typeof o === "string") {
      if (o.trim() !== "") opts.push({ label: o, value: o });
      continue;
    }
    if (o && typeof o === "object") {
      const rec = o as Record<string, unknown>;
      const value = typeof rec.value === "string" ? rec.value : null;
      const label = typeof rec.label === "string" ? rec.label : null;
      // value — то, что сверяется с ключом; без него вариант бесполезен, даже
      // если подпись есть. При отсутствии подписи показываем само значение.
      if (value && value.trim() !== "") opts.push({ label: label?.trim() || value, value });
    }
  }
  return opts.length > 0 ? opts : null;
}

/**
 * Сколько просроченных ошибок рассматриваем за один заход. Тот же потолок, что
 * показывает экран разбора, — чтобы число в сообщении «N ошибок ждут» совпадало
 * с тем, что человек увидит, перейдя по ссылке.
 */
const CANDIDATE_LIMIT = 50;

/** Итог выбора: что спросить и сколько ошибок ждёт повторения всего. */
export interface DailyPick {
  /** Вопрос, который имеет смысл задать в чате; null — таких сейчас нет. */
  question: DailyQuestion | null;
  /**
   * Сколько ошибок просрочено ВСЕГО, включая нерешаемые в переписке. Нужно, чтобы
   * у бота остался честный повод написать: «есть что повторить, но это на сайте»
   * лучше и молчания, и задачи без условия.
   */
  dueTotal: number;
}

const candidateKey = (contentItemId: string, questionNumber: number): string =>
  `${contentItemId}:${questionNumber}`;

/**
 * Сдвиг очереди по UTC-дню.
 *
 * Ответ в чате намеренно НЕ двигает SM-2 (повтор закрывается на сайте), а порядок
 * кандидатов детерминирован — значит без сдвига самая просроченная ошибка приходила
 * бы человеку каждый вечер, одна и та же, пока он не разберёт её руками. Волна
 * называется «удержание»; ежедневный дубль работает ровно наоборот (ревью 2026-08-07).
 *
 * Сдвиг именно по дню, а не случайный: в течение суток `/question` и вечерняя
 * рассылка обязаны говорить об одном вопросе, иначе рассылка «съедала» бы вопрос,
 * который человек уже открыл сам. Все кандидаты и так просрочены, так что порядок
 * внутри них не несёт смысла, которым мы бы жертвовали.
 */
export function rotateByDay<T>(items: T[], now: Date): T[] {
  if (items.length <= 1) return items;
  const dayIndex = Math.floor(now.getTime() / 86_400_000);
  const start = ((dayIndex % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

/**
 * Самая просроченная ошибка юзера, которую есть смысл спрашивать в чате.
 *
 * getOpenMistakes уже делает всю содержательную часть: сводит сданные попытки с их
 * review-снимком, перегрейживает тем же gradeOne, вычитает «Mark learned»-резолюции,
 * дедупит по свежайшей попытке и сортирует due-первыми. Здесь остаётся выбрать из
 * его кандидатов первого, к которому есть что показать: тест должен быть
 * опубликован (ссылка «разобрать» из снятого вела бы в никуда), а сам вопрос —
 * решаться в переписке (см. isChatAnswerable: «Paragraph A» без пассажа не задача,
 * а издевательство).
 *
 * Отдаёт заодно общее число просроченных ошибок: когда решаемых в чате нет, но
 * повторять есть что, бот зовёт на сайт вместо молчания.
 */
export async function pickDailyQuestion(
  userId: string,
  now: Date = new Date(),
): Promise<DailyPick> {
  const open = await getOpenMistakes(userId, { limit: CANDIDATE_LIMIT });
  const due = open.filter((m) => m.isDue);
  if (due.length === 0) return { question: null, dueTotal: 0 };
  // Сдвиг по дню — иначе одна и та же ошибка приходила бы каждый вечер (rotateByDay).
  const candidates = rotateByDay(due, now);

  // Один запрос на всех кандидатов, а не по запросу на каждого: их до двадцати, и
  // цикл с await внутри превратил бы вечернюю рассылку в лестницу round-trip'ов.
  const rows = await db
    .select({
      contentItemId: question.contentItemId,
      questionNumber: question.number,
      qtype: question.qtype,
      promptHtml: question.promptHtml,
      options: question.options,
      testTitle: contentItem.title,
    })
    .from(question)
    .innerJoin(contentItem, eq(contentItem.id, question.contentItemId))
    .where(
      and(
        eq(contentItem.status, "published"),
        or(
          ...candidates.map((m) =>
            and(
              eq(question.contentItemId, m.contentItemId),
              eq(question.number, m.questionNumber),
            ),
          ),
        ),
      ),
    );

  const byKey = new Map(rows.map((r) => [candidateKey(r.contentItemId, r.questionNumber), r]));

  // Порядок кандидатов (due-первые, самые просроченные сверху) — авторитетный;
  // берём первого, у которого нашлась пригодная строка вопроса.
  for (const m of candidates) {
    const row = byKey.get(candidateKey(m.contentItemId, m.questionNumber));
    if (!row) continue;
    const prompt = stripHtml(row.promptHtml).trim();
    if (!isChatAnswerable(row.qtype, prompt)) continue;
    return {
      question: {
        contentItemId: row.contentItemId,
        questionNumber: row.questionNumber,
        qtype: row.qtype,
        prompt,
        options: parseOptions(row.options),
        testTitle: row.testTitle,
      },
      dueTotal: candidates.length,
    };
  }
  return { question: null, dueTotal: candidates.length };
}

/**
 * Варианты конкретного вопроса — для разбора нажатия на кнопку. Значение ответа
 * восстанавливается на сервере по индексу: в 64 байта callback_data текст ответа
 * не влезает, да и доверять содержимому кнопки, пришедшему от клиента, незачем.
 *
 * Права здесь не проверяются намеренно: право нажать даёт ЗАЯВКА на ответ
 * (takePendingQuestion), а её бот ставит только на вопрос, выбранный из
 * собственных ошибок этого человека. Повторно угадывать «его ли это вопрос» по
 * текущей верхушке очереди было бы хуже: очередь меняется между показом и нажатием.
 */
export async function loadQuestionOptions(
  contentItemId: string,
  questionNumber: number,
): Promise<DailyQuestionOption[] | null> {
  const [row] = await db
    .select({ options: question.options })
    .from(question)
    .where(and(eq(question.contentItemId, contentItemId), eq(question.number, questionNumber)))
    .limit(1);
  return row ? parseOptions(row.options) : null;
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
