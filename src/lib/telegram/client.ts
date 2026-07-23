/**
 * Тонкий клиент Telegram Bot API на нативном fetch — БЕЗ внешних зависимостей
 * (package.json не трогаем). SERVER-ONLY: токен берётся из telegramConfig()
 * (src/env), браузеру не отдаётся. Используется только webhook-роутом импорта.
 */
import { telegramConfig } from "@/env";

const API = "https://api.telegram.org";

/** Вызов метода Bot API. Бросает при сетевой/логической ошибке Telegram. */
async function callApi<T>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const cfg = telegramConfig();
  if (!cfg) throw new Error("telegram: not configured");
  const res = await fetch(`${API}/bot${cfg.token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
  };
  if (!json.ok) {
    throw new Error(`telegram ${method} failed: ${json.description ?? res.status}`);
  }
  return json.result as T;
}

/**
 * Отправить текст в чат (подтверждение импорта / сообщение об ошибке).
 * BEST-EFFORT: не бросает — провал уведомления не должен ронять обработку апдейта.
 */
export async function sendMessage(chatId: number, text: string): Promise<void> {
  try {
    await callApi("sendMessage", { chat_id: chatId, text });
  } catch (e) {
    console.error("telegram sendMessage failed", e);
  }
}

/**
 * Сообщение об успешной загрузке + inline-кнопка «Опубликовать» (callback_data
 * несёт content_item id). BEST-EFFORT — не бросает.
 */
export async function sendUploadResult(
  chatId: number,
  text: string,
  contentItemId: string,
): Promise<void> {
  try {
    await callApi("sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [{ text: "📢 Опубликовать", callback_data: `publish:${contentItemId}` }],
        ],
      },
    });
  } catch (e) {
    console.error("telegram sendUploadResult failed", e);
  }
}

/**
 * Ответ на нажатие inline-кнопки (убирает «часики» на кнопке + всплывающий тост).
 * BEST-EFFORT — не бросает.
 */
export async function answerCallback(
  callbackId: string,
  text: string,
): Promise<void> {
  try {
    await callApi("answerCallbackQuery", {
      callback_query_id: callbackId,
      text,
    });
  } catch (e) {
    console.error("telegram answerCallback failed", e);
  }
}

/** file_id -> file_path (Bot API getFile). Бросает при ошибке. */
export async function getFilePath(fileId: string): Promise<string> {
  const result = await callApi<{ file_path: string }>("getFile", {
    file_id: fileId,
  });
  return result.file_path;
}

/**
 * Скачать файл по file_path как текст (HTML-тест). Bot API качает файлы до ~20 МБ
 * — HTML-тесты сильно меньше. Бросает при ошибке HTTP.
 */
export async function downloadFileText(filePath: string): Promise<string> {
  const cfg = telegramConfig();
  if (!cfg) throw new Error("telegram: not configured");
  const res = await fetch(`${API}/file/bot${cfg.token}/${filePath}`);
  if (!res.ok) throw new Error(`telegram download failed: ${res.status}`);
  return res.text();
}
