import "server-only";
import { logError } from "@/lib/monitoring/log-error";
import { callBotApi } from "@/lib/telegram/client";

/**
 * Отправка от имени СТУДЕНЧЕСКОГО бота (G2-1). Отдельно от админского клиента,
 * потому что здесь важен исход доставки: человек, заблокировавший бота, должен
 * перестать быть получателем — иначе рассылка вечно бьётся в стену и раздувает
 * лог ошибок.
 */

export type DeliveryResult = "ok" | "blocked" | "failed";

/** Кнопка ответа: подпись + callback_data. */
export interface InlineButton {
  text: string;
  data: string;
}

/**
 * Telegram отвечает 403 с описанием, когда бот заблокирован или чат удалён.
 * Отдельный класс исхода: это не сбой сети, повторять бессмысленно.
 */
function isBlocked(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("bot was blocked") ||
    m.includes("user is deactivated") ||
    m.includes("chat not found") ||
    m.includes("bot can't initiate conversation")
  );
}

export async function sendStudentMessage(
  token: string,
  chatId: number,
  text: string,
  buttons?: InlineButton[],
): Promise<DeliveryResult> {
  try {
    // По одной кнопке в ряд: варианты ответа бывают длинными, в строку они
    // схлопываются в нечитаемую кашу на телефоне.
    const reply_markup = buttons?.length
      ? { inline_keyboard: buttons.map((b) => [{ text: b.text, callback_data: b.data }]) }
      : undefined;
    await callBotApi(token, "sendMessage", {
      chat_id: chatId,
      text,
      // Разметку не включаем: тексты вопросов приходят из контента, и любой
      // markdown-символ в них ломал бы отправку целиком.
      //
      // Превью ссылок выключено: карточка сайта разворачивается на пол-экрана и
      // топит сам текст — в сообщении с вопросом это прямо мешает читать (видно
      // на живом прогоне 2026-08-05).
      link_preview_options: { is_disabled: true },
      ...(reply_markup ? { reply_markup } : {}),
    });
    return "ok";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const outcome: DeliveryResult = isBlocked(message) ? "blocked" : "failed";
    // Недоставленное сообщение читается человеком как «бот съел мой ответ», а
    // причина оседала только в console.error — то есть нигде, куда можно посмотреть
    // после факта. Логируем ОБА неуспешных исхода, включая `blocked`: «chat not
    // found» на ответ человеку, который только что нам написал, — это не отписка,
    // а признак того, что токен отвечает не за тот аккаунт бота, и молчать об этом
    // нельзя (диагностика 2026-08-07). Для рассылки это по строке на получателя
    // один раз: следующим шагом крон снимает связку.
    await logError({
      source: "server",
      message: `student bot sendMessage ${outcome}: ${message}`,
      context: { op: "sendStudentMessage", hasButtons: (buttons?.length ?? 0) > 0 },
    });
    return outcome;
  }
}

/** Гасит «часики» на нажатой кнопке. Best-effort — не бросает. */
export async function answerStudentCallback(
  token: string,
  callbackId: string,
  text?: string,
): Promise<void> {
  try {
    await callBotApi(token, "answerCallbackQuery", {
      callback_query_id: callbackId,
      ...(text ? { text } : {}),
    });
  } catch (e) {
    console.error("student bot answerCallback failed", e);
  }
}
