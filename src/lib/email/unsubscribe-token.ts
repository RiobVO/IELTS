import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Подписывает userId HMAC-SHA256 секретом рассылки — токен кладётся в ссылку
 * Unsubscribe письма, чтобы отписка работала без логина (одноразовая ссылка,
 * не сессия). Секрет — EMAIL_PROVIDER_API_KEY либо отдельный env, решает вызывающий.
 */
export function signUnsubscribeToken(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId).digest("hex");
}

/**
 * Проверка токена из публичной unsubscribe-ссылки. Fail-closed: любой пустой
 * вход (secret/token/userId) или конфиг без секрета → false, не throw — роут
 * не должен падать 500 на кривой query-параметр. Сравнение через
 * timingSafeEqual (защита от timing-атаки на подбор токена); буферы разной
 * длины (битый/невалидный hex) timingSafeEqual бросает сам, поэтому длины
 * сверяем заранее и на несовпадении возвращаем false без вызова.
 */
export function verifyUnsubscribeToken(
  userId: string,
  token: string,
  secret: string | null | undefined,
): boolean {
  if (!secret || !token || !userId) return false;
  const expected = Buffer.from(signUnsubscribeToken(userId, secret), "hex");
  // Buffer.from(str, "hex") не бросает на невалидном hex — молча обрезает на
  // первой непарной/недопустимой позиции, что и даёт несовпадение длины ниже.
  const actual = Buffer.from(token, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(expected, actual);
}
