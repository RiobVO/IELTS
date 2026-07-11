/**
 * Source-атрибуция (P5): различаем, из какого канала пришёл пользователь, до
 * регистрации. Owner раздаёт помеченные ссылки вида `https://bando.study/?src=<slug>`;
 * middleware ловит `?src=` и кладёт слаг в first-party cookie `bando_src`, а оба
 * signup-пути (email action + OAuth callback) читают её и вешают на событие/персону
 * в PostHog. Это НЕ реферальная система (`?ref=` — person-to-person, отдельный
 * механизм): здесь метка канала, а не конкретного пригласившего.
 *
 * Клиентский PostHog по дизайну режет query у $current_url/$referrer
 * (provider.tsx, before_send) — через pageview канал не пометить, поэтому связка
 * идёт server-side через cookie.
 */

/** Имя query-параметра в помеченной ссылке (`?src=<slug>`). */
export const SOURCE_QUERY_PARAM = "src";

/** Имя first-party cookie с меткой канала. Потребители — только серверные. */
export const SOURCE_COOKIE_NAME = "bando_src";

/** TTL cookie — 30 дней. Одноразовая тёплая волна укладывается с запасом; после —
 *  сама истечёт (при потреблении не удаляем, безвредна). */
export const SOURCE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Потолок длины слага. Реальные метки — короткие (`tg_main`); кап отсекает
 *  мусорные/раздутые значения из подделанного URL. */
const SOURCE_MAX_LEN = 32;

/** Разрешённый алфавит слага: строчная латиница, цифры, `_` и `-`. */
const SOURCE_PATTERN = /^[a-z0-9_-]+$/;

/**
 * Нормализует сырое значение `src` (из query или из cookie) к каноническому
 * слагу или `null`, если оно непригодно.
 *
 * Контракт: lowercase → обрезка до 32 символов → проверка алфавита. Возврат
 * ГАРАНТИРОВАННО матчит `[a-z0-9_-]{1,32}` либо `null`. Порядок «обрезать, потом
 * валидировать» делает выход всегда валидным: даже длинный ввод с мусорным хвостом
 * не протащит запрещённый символ в сохранённое значение.
 *
 * `null` (cookie не ставим / метку не пишем) для: не-строки, пустого, кириллицы и
 * любого символа вне алфавита.
 */
export function sanitizeSource(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const capped = raw.toLowerCase().slice(0, SOURCE_MAX_LEN);
  return SOURCE_PATTERN.test(capped) ? capped : null;
}
