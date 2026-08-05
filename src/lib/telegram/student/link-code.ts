/**
 * Одноразовый код привязки чата к аккаунту (G2-1).
 *
 * ПОЧЕМУ КОД, А НЕ chat_id. Админский бот импорта опознаёт отправителя по
 * whitelist'у Telegram user_id — там круг лиц известен заранее. Студенческий бот
 * открыт всем, и chat_id, который присылает Telegram, не доказывает НИЧЕГО о том,
 * чей это аккаунт на сайте. Доказательство создаёт залогиненный юзер: он получает
 * код в своём профиле (owner-path) и предъявляет его боту.
 *
 * Код короткоживущий и одноразовый, в БД лежит ХЕШЕМ: утечка строки не даёт
 * подключить чужой чат, как и утечка бэкапа. Энтропии 128 бит — перебор
 * бессмысленен, поэтому отдельный счётчик попыток на код не нужен (а троттл на
 * ВЫДАЧУ всё равно стоит, см. store.ts).
 */
import { createHash, randomBytes } from "node:crypto";

/** Время жизни кода: успеть переключиться в Telegram и нажать Start, не больше. */
export const LINK_CODE_TTL_MINUTES = 15;

/** Байт энтропии (16 = 128 бит). */
const CODE_BYTES = 16;

/** Разрешённые символы кода — то, что переживёт deep-link без экранирования. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;

/** Новый код привязки (base64url без паддинга) — отдаётся юзеру ОДИН раз. */
export function generateLinkCode(): string {
  return randomBytes(CODE_BYTES).toString("base64url");
}

/** Хеш кода для хранения. sha256 без соли осознанно: вход — 128 бит случайности,
 *  словарной атаки на него не существует, а детерминизм нужен для поиска по хешу. */
export function hashLinkCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Полезная нагрузка `/start <code>` из текста сообщения. `null` — это не команда
 * старта или код в ней отсутствует/не похож на наш (мусор в БД не ищем).
 */
export function parseStartPayload(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!/^\/start(@\w+)?(\s|$)/i.test(trimmed)) return null;
  const parts = trimmed.split(/\s+/);
  const payload = parts[1];
  if (!payload || !CODE_PATTERN.test(payload)) return null;
  return payload;
}

/** Deep-link, который юзер открывает из профиля. `null`, если имя бота неизвестно. */
export function buildDeepLink(botUsername: string | null, code: string): string | null {
  if (!botUsername) return null;
  return `https://t.me/${botUsername}?start=${encodeURIComponent(code)}`;
}
