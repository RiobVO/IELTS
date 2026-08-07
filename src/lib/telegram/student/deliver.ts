import "server-only";
import { publicSiteUrl } from "@/env";
import { sendStudentMessage, type DeliveryResult } from "./client";
import { buildDailyQuestionCallback } from "./commands";
import type { DailyQuestion } from "./daily-question";
import { questionMessage } from "./messages";
import { setPendingQuestion } from "./store";

/**
 * Доставка «вопроса дня» — общая для вебхука (команда /question) и ежедневной
 * рассылки. Живёт отдельным модулем, потому что route.ts в Next может
 * экспортировать только обработчики HTTP, а дублировать отправку в двух местах
 * значило бы разъехаться формой кнопок при первой же правке.
 */

/** Куда ведём «закрыть ошибку по-настоящему». */
export function mistakesUrl(): string | null {
  const origin = publicSiteUrl();
  return origin ? `${origin}/app/practice/mistakes?src=tg_bot` : null;
}

export function practiceUrl(): string | null {
  const origin = publicSiteUrl();
  return origin ? `${origin}/app/practice?src=tg_bot` : null;
}

/** Максимум символов на кнопке: длинные подписи Telegram обрезает сам, но по своим
 *  правилам и без многоточия — лучше решить это самим и предсказуемо. */
const MAX_BUTTON_LABEL = 60;

/**
 * Подпись кнопки. Когда значение и текст различаются (matching_headings: «iii» и
 * сам заголовок), показываем оба — иначе человек видит список одинаковых римских
 * цифр или, наоборот, текст без метки, которую ждёт экзамен.
 */
export function buttonLabel(value: string, label: string): string {
  const full = value === label ? label : `${value} — ${label}`;
  return full.length <= MAX_BUTTON_LABEL ? full : `${full.slice(0, MAX_BUTTON_LABEL - 1)}…`;
}

export async function deliverQuestion(
  token: string,
  chatId: number,
  userId: string,
  q: DailyQuestion,
): Promise<DeliveryResult> {
  const text = questionMessage({
    prompt: q.prompt,
    testTitle: q.testTitle,
    questionNumber: q.questionNumber,
    hasOptions: q.options != null,
  });

  // Ожидание ставим ДЛЯ ЛЮБОГО вопроса, не только для свободного ввода: оно же
  // служит признаком «на этот вопрос ещё не отвечали». Первое нажатие забирает его
  // атомарно, поэтому повторные тапы по тем же кнопкам вердикта уже не дают.
  // До отправки, а не после: callback от быстрого пальца приходит через миллисекунды.
  await setPendingQuestion(userId, q.contentItemId, q.questionNumber);

  if (q.options) {
    // По кнопке на вариант; значение ответа берётся на сервере по индексу, поэтому
    // в callback_data едут только идентификаторы (лимит Telegram — 64 байта).
    return sendStudentMessage(
      token,
      chatId,
      text,
      q.options.map((opt, i) => ({
        text: buttonLabel(opt.value, opt.label),
        data: buildDailyQuestionCallback({
          contentItemId: q.contentItemId,
          questionNumber: q.questionNumber,
          optionIndex: i,
        }),
      })),
    );
  }

  // Свободный ввод: ожидание уже поставлено выше — следующий текст станет ответом.
  return sendStudentMessage(token, chatId, text);
}
