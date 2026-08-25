/**
 * IP/идентификатор-throttle на общей таблице `signup_throttle` (§11 anti-abuse).
 * SERVER-ONLY.
 *
 * Извлечён из `app/auth/actions.ts` без изменения поведения, когда появился второй
 * потребитель — публичный Band Predictor (G1-6): тот же механизм, та же таблица,
 * тот же контракт, поэтому копия кода означала бы две расходящиеся реализации
 * анти-абуза. Scope по-прежнему едет ПРЕФИКСОМ в хешируемом ключе
 * (`sha256("<scope>:<identifier>")`), так что счётчики разных сценариев не
 * пересекаются, и отдельная колонка под scope не нужна.
 */
import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { signupThrottle } from "@/db/schema";
import {
  AUTH_THROTTLE_LIMITS,
  type AuthThrottleScope,
  exceedsAuthThrottle,
} from "@/lib/anti-cheat";

/**
 * true → лимит для этого (scope, identifier) исчерпан, вызывающий обязан отклонить
 * попытку. `identifier` по умолчанию — IP звонящего (x-forwarded-for ставит Vercel);
 * per-email вызовы передают его явно, чтобы общий NAT-адрес не душил email-лимит.
 *
 * COUNT и INSERT атомарны под advisory-xact-lock, и лок TRY, а не блокирующий: под
 * burst'ом на один ключ конкурирующие вызовы не встают в очередь ожидания (waiter
 * держал бы server-connection пула PgBouncer в transaction-режиме — burst мог бы
 * выесть пул). Занятый лок = для того же ключа прямо сейчас идёт другой COUNT→INSERT,
 * поэтому считаем попытку throttled (fail closed). Лок снимается на commit/rollback.
 */
export async function checkIpThrottle(
  scope: AuthThrottleScope,
  identifier?: string,
): Promise<boolean> {
  const { windowSeconds } = AUTH_THROTTLE_LIMITS[scope];
  let key = identifier;
  if (!key) {
    const h = await headers();
    key = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  }
  const ipHash = createHash("sha256").update(`${scope}:${key}`).digest("hex");
  const since = new Date(Date.now() - windowSeconds * 1000);
  return db.transaction(async (tx) => {
    const [lockRow] = await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtext(${ipHash})) as locked`,
    );
    const locked = Boolean((lockRow as { locked: boolean }).locked);
    if (!locked) return true;
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(signupThrottle)
      .where(and(eq(signupThrottle.ipHash, ipHash), gte(signupThrottle.createdAt, since)));
    const exceeded = exceedsAuthThrottle(scope, recent?.n ?? 0);
    if (!exceeded) await tx.insert(signupThrottle).values({ ipHash });
    return exceeded;
  });
}
