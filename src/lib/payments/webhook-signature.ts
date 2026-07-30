import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Constant-time проверка HMAC-SHA256(rawBody, secret) в hex против присланной
 * подписи. Чистая (только node:crypto) — тестируется без env/db.
 *
 * ПЛЕЙСХОЛДЕР-схема: у каждого провайдера своя (Payme Basic-auth, Click
 * md5-конкатенация, Uzum свой HMAC) — заменить на провайдер-специфичную при
 * онбординге мерчанта. Инвариант, который держим уже сейчас: сравнение
 * constant-time (timingSafeEqual), и любая невалидная подпись (пустая, не-hex,
 * неверной длины, чужой секрет, изменённое тело) → false.
 */
export function hmacHexValid(
  secret: string,
  sentHex: string | null | undefined,
  rawBody: string,
): boolean {
  if (!sentHex) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  // Buffer.from(..,"hex") не бросает: на не-hex/нечётной длине обрезает до
  // валидного префикса (вплоть до пустого) — поймается проверкой длины ниже.
  const sentBuf = Buffer.from(sentHex, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (sentBuf.length === 0 || sentBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(sentBuf, expectedBuf);
}
