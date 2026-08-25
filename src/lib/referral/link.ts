/**
 * Реф-ссылка, пережившая посадку на публичную страницу (G1-5).
 *
 * Дыра, которую это закрывает: делились ссылкой вида `https://bando.study/?ref=CODE`
 * (ShareResult, W1-5), но лендинг и `/pricing` ведут на голый `/auth` — код терялся
 * при первом же клике, и приглашение не засчитывалось никому. Ловим `?ref=` в
 * middleware в first-party cookie (тот же механизм, что метка канала `bando_src`),
 * а `/auth` читает её как fallback к query-параметру: работают ОБА signup-пути —
 * и форма (hidden input), и Google OAuth (ref едет в redirectTo).
 *
 * Это НЕ метка канала: `?src=` — откуда пришёл трафик, `?ref=` — КТО конкретно
 * пригласил. Разные cookie, разные потребители, разные сроки жизни по смыслу.
 */

/** Имя query-параметра в реф-ссылке (`?ref=<code>`). */
export const REF_QUERY_PARAM = "ref";

/** Имя first-party cookie с кодом пригласившего. Читают только серверные потребители. */
export const REF_COOKIE_NAME = "bando_ref";

/** TTL — 30 дней, как у метки канала: приглашение живёт дольше одной сессии. */
export const REF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Формат кода: `profile.referral_code` генерится триггером 0005 как
 * `upper(substr(uuid, 1, 10))` — 10 символов [A-F0-9]. Валидируем шире (буквы+цифры,
 * 4..32), чтобы не сломаться на смене генератора, но достаточно узко, чтобы в
 * cookie/метаданные не уехало произвольное содержимое.
 */
const REF_PATTERN = /^[A-Z0-9]{4,32}$/;

/**
 * Нормализует сырой `ref` (из query или cookie) к каноничному коду или `null`.
 * Контракт как у sanitizeSource: trim → upper → проверка алфавита и длины.
 * Возврат ГАРАНТИРОВАННО матчит `[A-Z0-9]{4,32}` либо `null`.
 *
 * `null` (cookie не ставим, в signup не передаём) для: не-строки, пустого,
 * слишком длинного, кириллицы и любого символа вне алфавита. Существование кода
 * здесь НЕ проверяется — это делает БД-триггер (несуществующий код просто не
 * находит пригласившего, self-referral отсекается там же).
 */
export function sanitizeRefCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return REF_PATTERN.test(code) ? code : null;
}
