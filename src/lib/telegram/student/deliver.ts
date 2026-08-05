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

  if (q.options) {
    // По кнопке на вариант; значение ответа берётся на сервере по индексу, поэтому
    // в callback_data едут только идентификаторы (лимит Telegram — 64 байта).
    return sendStudentMessage(
      token,
      chatId,
      text,
      q.options.map((opt, i) => ({
        text: opt,
        data: buildDailyQuestionCallback({
          contentItemId: q.contentItemId,
          questionNumber: q.questionNumber,
          optionIndex: i,
        }),
      })),
    );
  }

  // Свободный ввод: запоминаем, чего ждём, — следующий текст станет ответом.
  await setPendingQuestion(userId, q.contentItemId, q.questionNumber);
  return sendStudentMessage(token, chatId, text);
}
