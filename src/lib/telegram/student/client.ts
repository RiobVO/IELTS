import "server-only";
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
      ...(reply_markup ? { reply_markup } : {}),
    });
    return "ok";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isBlocked(message)) return "blocked";
    console.error("student bot sendMessage failed", message);
    return "failed";
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
