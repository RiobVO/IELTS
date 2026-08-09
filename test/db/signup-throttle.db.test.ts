// Транзакционный инвариант signup velocity-cap (аудит 2026-07-17, minor #4):
// COUNT→INSERT атомарен под advisory try-lock (checkIpThrottle) — конкурентный
// burst у границы капа занимает ровно последний слот и не пишет сверх max.
// До консолидации inline-путь signUp был check-then-act без лока: гонка
// пропускала лишние регистрации сверх капа. Ровно один false обязателен в ОБОИХ
// интерливингах: contended (лок занят → fail closed) и serialized (второй видит
// count=max). Гонять ×5 (правило конкурентных тестов) — раунды внутри теста
// дают пять гонок с разными ключами за прогон.
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { db } from "@/db";
import { checkIpThrottle } from "@/lib/anti-bot/ip-throttle";
import { AUTH_THROTTLE_LIMITS } from "@/lib/anti-cheat";

// Свой raw-клиент для сида/инспекции — ОТДЕЛЬНО от app-пула @/db под тестом
// (тот же приём, что schema.db.test.ts / payments.db.test.ts).
const sql = postgres(process.env.VERIFY_DATABASE_URL!, {
  max: 1,
  onnotice: () => {},
});

const { max } = AUTH_THROTTLE_LIMITS.signup;

/** Формат ключа продакшена: sha256("<scope>:<identifier>") — см. checkIpThrottle. */
function signupKeyHash(identifier: string): string {
  return createHash("sha256").update(`signup:${identifier}`).digest("hex");
}

beforeEach(async () => {
  await sql`TRUNCATE signup_throttle`;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  // app-пул @/db держит воркер живым; drizzle-postgres-js экспонирует raw-клиент.
  const client = (
    db as unknown as {
      $client?: { end: (o?: { timeout?: number }) => Promise<void> };
    }
  ).$client;
  if (client?.end) await client.end({ timeout: 5 });
});

describe("checkIpThrottle('signup') — атомарность у границы капа", () => {
  it("конкурентный burst на последний слот: ровно один проходит, счёт ровно max", async () => {
    for (let round = 0; round < 5; round++) {
      const identifier = `10.0.${round}.1`;
      const ipHash = signupKeyHash(identifier);
      // max-1 свежих строк: остался ровно один слот.
      await sql`
        INSERT INTO signup_throttle (ip_hash)
        SELECT ${ipHash} FROM generate_series(1, ${max - 1})`;

      const results = await Promise.all(
        Array.from({ length: 4 }, () => checkIpThrottle("signup", identifier)),
      );

      // false = попытка пропущена. Ровно один, не «не больше одного»: иначе
      // реализация, отклоняющая вообще всех, тоже прошла бы тест.
      expect(results.filter((r) => r === false)).toHaveLength(1);
      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM signup_throttle WHERE ip_hash = ${ipHash}`;
      expect(n).toBe(max);
    }
  });

  it("под потолком пропускает и пишет строку; на потолке отклоняет без записи", async () => {
    const identifier = "10.1.0.1";
    const ipHash = signupKeyHash(identifier);

    expect(await checkIpThrottle("signup", identifier)).toBe(false);
    let [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM signup_throttle WHERE ip_hash = ${ipHash}`;
    expect(n).toBe(1);

    await sql`
      INSERT INTO signup_throttle (ip_hash)
      SELECT ${ipHash} FROM generate_series(1, ${max - 1})`;
    expect(await checkIpThrottle("signup", identifier)).toBe(true);
    [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM signup_throttle WHERE ip_hash = ${ipHash}`;
    expect(n).toBe(max); // отклонённая попытка строку не добавляет
  });
});
