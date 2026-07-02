/**
 * Тонкий клиент Telegram Bot API на нативном fetch — БЕЗ внешних зависимостей
 * (package.json не трогаем). SERVER-ONLY: токен берётся из telegramConfig()
 * (src/env), браузеру не отдаётся. Используется только webhook-роутом импорта.
 */
import { telegramConfig, publicSiteUrl } from "@/env";

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
  // Публикацию review-гейт не пустит без Approve в /admin — даём прямую ссылку
  // с якорем на тест, чтобы весь цикл (upload → review → publish) закрывался
  // с телефона, без ручной навигации по админке.
  const origin = publicSiteUrl();
  const keyboard: Array<Array<Record<string, string>>> = [
    [{ text: "📢 Опубликовать", callback_data: `publish:${contentItemId}` }],
  ];
  if (origin) {
    keyboard.push([{ text: "🔍 Review в админке", url: `${origin}/admin#${contentItemId}` }]);
  }
  try {
    await callApi("sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: keyboard },
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

// N12: Bot API сам не отдаёт файлы больше ~20 МБ, но полагаться на чужой лимит
// нельзя (прокси/изменение API) — явный стриминговый cap вместо чтения всего тела
// в память (admin-only канал, так что вектор — self-DoS, не атака).
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

async function readBodyCapped(res: Response, max: number): Promise<ArrayBuffer> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    throw new Error(`telegram download exceeds ${max} bytes (declared ${declared})`);
  }
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > max) throw new Error(`telegram download exceeds ${max} bytes`);
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error(`telegram download exceeds ${max} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer;
}

/**
 * Скачать файл по file_path как текст (HTML-тест). Bot API качает файлы до ~20 МБ
 * — HTML-тесты сильно меньше. Бросает при ошибке HTTP или превышении cap.
 */
export async function downloadFileText(filePath: string): Promise<string> {
  const cfg = telegramConfig();
  if (!cfg) throw new Error("telegram: not configured");
  const res = await fetch(`${API}/file/bot${cfg.token}/${filePath}`);
  if (!res.ok) throw new Error(`telegram download failed: ${res.status}`);
  return new TextDecoder().decode(await readBodyCapped(res, MAX_DOWNLOAD_BYTES));
}

/** Скачать файл по file_path как байты (mp3-аудио). Бросает при ошибке HTTP/cap. */
export async function downloadFileBytes(filePath: string): Promise<ArrayBuffer> {
  const cfg = telegramConfig();
  if (!cfg) throw new Error("telegram: not configured");
  const res = await fetch(`${API}/file/bot${cfg.token}/${filePath}`);
  if (!res.ok) throw new Error(`telegram download failed: ${res.status}`);
  return readBodyCapped(res, MAX_DOWNLOAD_BYTES);
}
