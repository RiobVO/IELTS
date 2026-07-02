import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time сравнение secret-token вебхука (N12): `!==` отдаёт тайминг-оракул
 * по длине совпавшего префикса. Сравнение длин не утекает содержимое (длина
 * секрета не секрет). Чистая функция — тестируется без env.
 */
export function webhookSecretValid(sent: string | null | undefined, expected: string): boolean {
  if (!sent) return false;
  const sentBuf = Buffer.from(sent);
  const expectedBuf = Buffer.from(expected);
  if (sentBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(sentBuf, expectedBuf);
}
