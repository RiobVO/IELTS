/**
 * Sanitizer для пост-логин `next`-редиректа (auth form action + OAuth callback).
 *
 * Сырой `next` приходит из query/form, попадает в `redirect(next)` после
 * успешной авторизации. Без нормализации это open-redirect: легитимный логин
 * уводит на чужой origin (phishing-вектор). Пропускаем ТОЛЬКО корневой
 * относительный путь; всё, что может покинуть наш origin или инъектить
 * заголовок Location, схлопываем в безопасный fallback `/app`.
 *
 * Отсекаем:
 *   - не-корневые значения и absolute-URL со схемой (`https:`, `javascript:`) —
 *     не начинаются с одного `/`;
 *   - protocol-relative `//host` — второй `/`;
 *   - backslash `\` — браузеры нормализуют его в `/`, так что `/\evil` == `//evil`;
 *   - control-символы и пробелы (CR/LF/таб/space) — инъекция в Location / битый URL.
 */
const FALLBACK = "/app";

export function safeNextPath(value: string | undefined | null): string {
  if (typeof value !== "string") return FALLBACK;
  // Ровно один ведущий `/`: корневой путь, но не protocol-relative `//host`.
  if (value[0] !== "/" || value[1] === "/") return FALLBACK;
  // Backslash (0x5C), любой control-символ/пробел (<= 0x20) или DEL (0x7F).
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x5c || c <= 0x20 || c === 0x7f) return FALLBACK;
  }
  return value;
}
