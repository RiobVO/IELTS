/**
 * Чистая логика outbox-lite для weekly digest (без БД/сети/server-only) — ради
 * юнит-теста и как защитный слой поверх SQL-фильтра ретрая. Маркер доставки живёт
 * в jsonb-поле `data` claim-строки (migration 0043/0046 — без новой миграции):
 * claim пишет `sent:false` (pending), успешная доставка флипает в `sent:true`.
 * `sent:false` = доставка не финализирована (транзиентный сбой sendEmail) → строку
 * добирает повторный прогон. ВАЖНО: именно строго `false`, а не «отсутствие ключа»:
 * legacy-строки прошлых прогонов (до этого кода) ключа `sent` не имеют и НЕ должны
 * попадать в ретрай (иначе неделя деплоя = волна дублей уже доставленным).
 */

/** Числовая часть claim-строки, нужная чтобы пересобрать письмо на ретрае. */
export interface DigestClaimStats {
  rating: number;
  ratingDelta: number | null;
  testsCount: number;
  avgBand: number | null;
  avgPercent: number | null;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

/**
 * Нужна ли повторная отправка по claim-строке дайджеста. true = строка ТЕКУЩЕЙ
 * недели в состоянии pending (`sent === false`). Доставленные (`sent:true`) и
 * legacy-строки без ключа `sent` — исключены. SQL уже сужает выборку, это защитный
 * фильтр и точка юнит-теста граничных форм `data`.
 */
export function digestNeedsRetry(data: unknown, weekKey: string): boolean {
  const d = asRecord(data);
  if (d === null) return false;
  if (d.week !== weekKey) return false;
  return d.sent === false;
}

/** Мягкий разбор числа: number | числовая строка → finite number, иначе null. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Достаёт числа для письма из claim-строки. Возвращает null, если нет rating или
 * testsCount — без них письмо не собрать (кривой/усечённый `data`), такую строку
 * ретрай пропускает, оставляя как есть. avgBand/avgPercent/ratingDelta допускают
 * null (первая неделя / нет full-40Q attempt).
 */
export function parseDigestClaimStats(data: unknown): DigestClaimStats | null {
  const d = asRecord(data);
  if (d === null) return null;
  const rating = num(d.rating);
  const testsCount = num(d.testsCount);
  if (rating === null || testsCount === null) return null;
  return {
    rating,
    ratingDelta: num(d.ratingDelta),
    testsCount,
    avgBand: num(d.avgBand),
    avgPercent: num(d.avgPercent),
  };
}
