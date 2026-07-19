import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { applyCompletedPayment } from "@/lib/payments";
import { findPlan } from "@/lib/payments/plans";
import { db } from "@/db";

/**
 * 0a-db (TESTING_PLAN §4): транзакционные платёжные инварианты на РЕАЛЬНОМ
 * throwaway-PG — то, что мок-тесты честно пометили как «предикат запинен,
 * атомарность не доказана». Схему готовит test/db-global-setup.ts, env
 * перехватывает test/db-setup.ts (DATABASE_URL → VERIFY_DATABASE_URL до
 * импорта @/db).
 *
 * Дефолт — stub-режим (merchant-ключи вычищены setup'ом): тестируем
 * транзакционное ядро (claim/row-lock/rollback/stacking). Real-режим включается
 * точечно vi.stubEnv'ом PAYME_MERCHANT_KEY — reconcileClaims сам по себе покрыт
 * юнитами, здесь только его связка с реальной строкой.
 */

// Свой raw-клиент для сида/инспекции — ОТДЕЛЬНО от app-пула @/db под тестом
// (тот же приём, что verify.ts). max:1 — сид последовательный.
const sql = postgres(process.env.VERIFY_DATABASE_URL!, {
  max: 1,
  onnotice: () => {},
});

const premium1 = findPlan("premium", 1)!;
const ultra1 = findPlan("ultra", 1)!;

let userSeq = 0;

/** INSERT в auth.users — profile создаёт SECURITY DEFINER триггер миграции 0002. */
async function seedUser(): Promise<string> {
  userSeq++;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (email) VALUES (${`dbtest-${userSeq}@test.local`})
    RETURNING id`;
  const [prof] = await sql<{ id: string }[]>`
    SELECT id FROM profile WHERE id = ${row!.id}`;
  expect(prof?.id).toBe(row!.id); // auth-триггер обязан был создать profile
  return row!.id;
}

let txSeq = 0;

async function seedPending(
  userId: string,
  opts: {
    tier?: "premium" | "ultra";
    months?: number;
    amount?: number;
    currency?: string;
    status?: "pending" | "completed" | "failed";
    expiresAt?: Date | null;
    txId?: string;
  } = {},
): Promise<string> {
  txSeq++;
  const tier = opts.tier ?? "premium";
  const months = opts.months ?? 1;
  const txId = opts.txId ?? `dbtest_tx_${txSeq}`;
  await sql`
    INSERT INTO payment
      (user_id, provider, provider_transaction_id, tier, period_months,
       amount, currency, status, expires_at)
    VALUES
      (${userId}, 'payme', ${txId}, ${tier}, ${months},
       ${opts.amount ?? findPlan(tier, months)!.amount}, ${opts.currency ?? "UZS"},
       ${opts.status ?? "pending"}, ${opts.expiresAt ?? null})`;
  return txId;
}

async function paymentStatus(txId: string): Promise<string> {
  const [row] = await sql<{ status: string }[]>`
    SELECT status FROM payment
    WHERE provider = 'payme' AND provider_transaction_id = ${txId}`;
  return row!.status;
}

async function profileGrant(
  userId: string,
): Promise<{ tier: string; premiumUntil: Date | null }> {
  const [row] = await sql<{ tier: string; premium_until: Date | null }[]>`
    SELECT tier, premium_until FROM profile WHERE id = ${userId}`;
  return { tier: row!.tier, premiumUntil: row!.premium_until };
}

/** premium_until внутри ±tolSec от `now() + <expr>` — сравнение НА СТОРОНЕ SQL,
 *  той же interval-арифметикой, что использует applyCompletedPayment. */
async function premiumUntilNear(
  userId: string,
  intervalExpr: string,
  tolSec = 10,
): Promise<boolean> {
  const [row] = await sql.unsafe<{ ok: boolean }[]>(
    `SELECT premium_until BETWEEN
        now() + interval '${intervalExpr}' - interval '${tolSec} seconds'
        AND now() + interval '${intervalExpr}' + interval '${tolSec} seconds' AS ok
     FROM profile WHERE id = $1`,
    [userId],
  );
  return row!.ok;
}

const INJECT_SQL = {
  raise: `
    CREATE OR REPLACE FUNCTION _inject_profile_fail() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected profile failure'; END $$;
    CREATE TRIGGER _inject_fail BEFORE UPDATE ON profile
      FOR EACH ROW EXECUTE FUNCTION _inject_profile_fail();`,
  swallow: `
    CREATE OR REPLACE FUNCTION _swallow_profile_update() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
    CREATE TRIGGER _swallow_update BEFORE UPDATE ON profile
      FOR EACH ROW EXECUTE FUNCTION _swallow_profile_update();`,
  cleanup: `
    DROP TRIGGER IF EXISTS _inject_fail ON profile;
    DROP FUNCTION IF EXISTS _inject_profile_fail();
    DROP TRIGGER IF EXISTS _swallow_update ON profile;
    DROP FUNCTION IF EXISTS _swallow_profile_update();`,
};

beforeEach(async () => {
  // Полный чистый лист: TRUNCATE auth.users каскадом сносит profile → payment;
  // error_log (пишет logError в error-кейсах, вне откаченной tx) чистится явно.
  await sql`TRUNCATE auth.users, error_log CASCADE`;
});

afterEach(async () => {
  vi.unstubAllEnvs(); // real-режим (PAYME_MERCHANT_KEY) не утекает в соседний тест
  await sql.unsafe(INJECT_SQL.cleanup); // инъекции не переживают свой тест даже при fail
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

describe("конкурентные webhook одного платежа", () => {
  it("8 параллельных применений → ровно один applied, остальные duplicate, продление РОВНО один раз", async () => {
    const userId = await seedUser();
    const txId = await seedPending(userId);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => applyCompletedPayment("payme", txId)),
    );

    expect(results.filter((r) => r === "applied")).toHaveLength(1);
    expect(results.filter((r) => r === "duplicate")).toHaveLength(7);
    expect(await paymentStatus(txId)).toBe("completed");
    // Продление одним периодом, не восемью: premium_until ≈ now + 1 месяц.
    expect(await premiumUntilNear(userId, "1 month")).toBe(true);
    expect((await profileGrant(userId)).tier).toBe("premium");
  });

  it("два РАЗНЫХ pending одного юзера конкурентно → оба applied, периоды сложились (2 месяца)", async () => {
    const userId = await seedUser();
    const tx1 = await seedPending(userId);
    const tx2 = await seedPending(userId);

    const results = await Promise.all([
      applyCompletedPayment("payme", tx1),
      applyCompletedPayment("payme", tx2),
    ]);

    expect(results).toEqual(["applied", "applied"]);
    // Оба same-tier (premium) → второй стекается поверх первого: суммарно 2 месяца.
    expect(await premiumUntilNear(userId, "2 months")).toBe(true);
  });
});

describe("идемпотентность / replay / out-of-order", () => {
  it("replay после completed → duplicate, premium_until не двигается, строка остаётся completed", async () => {
    const userId = await seedUser();
    const txId = await seedPending(userId);

    expect(await applyCompletedPayment("payme", txId)).toBe("applied");
    const before = (await profileGrant(userId)).premiumUntil;
    expect(before).not.toBeNull();

    expect(await applyCompletedPayment("payme", txId)).toBe("duplicate");
    expect((await profileGrant(userId)).premiumUntil?.getTime()).toBe(
      before!.getTime(),
    );
    expect(await paymentStatus(txId)).toBe("completed");
  });

  it("real-режим: событие cancelled ПОСЛЕ completed (не по порядку) → duplicate, терминал не регрессирует", async () => {
    const userId = await seedUser();
    const txId = await seedPending(userId);
    expect(await applyCompletedPayment("payme", txId)).toBe("applied");

    vi.stubEnv("PAYME_MERCHANT_KEY", "test-merchant-key");
    const out = await applyCompletedPayment("payme", txId, {
      amount: premium1.amount,
      currency: "UZS",
      status: "cancelled",
    });

    // Ранний duplicate-guard срабатывает ДО reconcile: completed не откатывается
    // в failed/cancelled ни при каком позднем событии.
    expect(out).toBe("duplicate");
    expect(await paymentStatus(txId)).toBe("completed");
  });

  it("real-режим: событие pending-статуса на pending-строке → ignored, строка НЕ терминалится", async () => {
    const userId = await seedUser();
    const txId = await seedPending(userId);

    vi.stubEnv("PAYME_MERCHANT_KEY", "test-merchant-key");
    const out = await applyCompletedPayment("payme", txId, {
      amount: premium1.amount,
      currency: "UZS",
      status: "pending",
    });

    expect(out).toBe("ignored");
    expect(await paymentStatus(txId)).toBe("pending"); // charge ещё может завершиться
    expect((await profileGrant(userId)).premiumUntil).toBeNull();

    // …и завершается: completed-событие после ignored выдаёт доступ.
    const done = await applyCompletedPayment("payme", txId, {
      amount: premium1.amount,
      currency: "UZS",
      status: "completed",
    });
    expect(done).toBe("applied");
  });

  it("real-режим: недоплата (amount меньше заказа) → invalid, строка failed, доступ НЕ выдан", async () => {
    const userId = await seedUser();
    const txId = await seedPending(userId);

    vi.stubEnv("PAYME_MERCHANT_KEY", "test-merchant-key");
    const out = await applyCompletedPayment("payme", txId, {
      amount: premium1.amount - 100,
      currency: "UZS",
      status: "completed",
    });

    expect(out).toBe("invalid");
    expect(await paymentStatus(txId)).toBe("failed");
    expect((await profileGrant(userId)).premiumUntil).toBeNull();
  });
});

describe("атомарность «оплата → выдача» / восстановимость", () => {
  it("падение внутри транзакции (RAISE на UPDATE profile) → error, claim ОТКАЧЕН (строка pending), ретрай после починки выдаёт доступ", async () => {
    const userId = await seedUser();
    const txId = await seedPending(userId);

    await sql.unsafe(INJECT_SQL.raise);
    expect(await applyCompletedPayment("payme", txId)).toBe("error");
    // «Деньги подтверждены, внутренняя операция упала»: восстановимое состояние —
    // платёж НЕ потерян (снова pending, не completed-без-доступа), профиль не тронут.
    expect(await paymentStatus(txId)).toBe("pending");
    expect((await profileGrant(userId)).premiumUntil).toBeNull();

    await sql.unsafe(INJECT_SQL.cleanup);
    // Ретрай провайдера (вебхук ответил 500) завершает платёж.
    expect(await applyCompletedPayment("payme", txId)).toBe("applied");
    expect(await paymentStatus(txId)).toBe("completed");
    expect(await premiumUntilNear(userId, "1 month")).toBe(true);
  });

  it("guard нулевого UPDATE profile: подавленный апдейт (RETURN NULL, 0 строк БЕЗ ошибки) → error + rollback, НЕ молчаливый completed", async () => {
    const userId = await seedUser();
    const txId = await seedPending(userId);

    // Drizzle не бросает на нулевом апдейте — ровно этот кейс: триггер глотает
    // UPDATE (0 строк, без исключения). Без guard'а исход был бы "applied" +
    // completed-строка при нетронутом profile — молчаливая потеря выдачи.
    await sql.unsafe(INJECT_SQL.swallow);
    expect(await applyCompletedPayment("payme", txId)).toBe("error");
    expect(await paymentStatus(txId)).toBe("pending");
    expect((await profileGrant(userId)).premiumUntil).toBeNull();

    await sql.unsafe(INJECT_SQL.cleanup);
    expect(await applyCompletedPayment("payme", txId)).toBe("applied");
    expect(await premiumUntilNear(userId, "1 month")).toBe(true);
  });
});

describe("продление / upgrade / downgrade (реальный SQL-интервал)", () => {
  it("same-tier: новый срок ложится ПОВЕРХ остатка (greatest(now, premium_until) + interval)", async () => {
    const userId = await seedUser();
    await sql`UPDATE profile
      SET tier = 'premium', premium_until = now() + interval '10 days'
      WHERE id = ${userId}`;
    const txId = await seedPending(userId, { tier: "premium", months: 1 });

    expect(await applyCompletedPayment("payme", txId)).toBe("applied");
    expect(await premiumUntilNear(userId, "10 days 1 month")).toBe(true);
  });

  it("upgrade Premium→Ultra: интервал стартует от now(), остаток Premium НЕ дарит Ultra-время", async () => {
    const userId = await seedUser();
    await sql`UPDATE profile
      SET tier = 'premium', premium_until = now() + interval '10 days'
      WHERE id = ${userId}`;
    const txId = await seedPending(userId, {
      tier: "ultra",
      months: 1,
      amount: ultra1.amount,
    });

    expect(await applyCompletedPayment("payme", txId)).toBe("applied");
    const grant = await profileGrant(userId);
    expect(grant.tier).toBe("ultra");
    // Ровно 1 месяц от now(), НЕ 10 дней + месяц (дешёвый апгрейд поверх остатка).
    expect(await premiumUntilNear(userId, "1 month")).toBe(true);
  });

  it("downgrade Ultra→Premium: тариф перезаписывается, срок от now() (остаток Ultra не наследуется)", async () => {
    const userId = await seedUser();
    await sql`UPDATE profile
      SET tier = 'ultra', premium_until = now() + interval '300 days'
      WHERE id = ${userId}`;
    const txId = await seedPending(userId, { tier: "premium", months: 1 });

    expect(await applyCompletedPayment("payme", txId)).toBe("applied");
    const grant = await profileGrant(userId);
    expect(grant.tier).toBe("premium");
    expect(await premiumUntilNear(userId, "1 month")).toBe(true);
  });
});

describe("срок жизни pending / терминальность", () => {
  it("протухший pending → expired, строка failed, доступ не выдан", async () => {
    const userId = await seedUser();
    const txId = await seedPending(userId, {
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    expect(await applyCompletedPayment("payme", txId)).toBe("expired");
    expect(await paymentStatus(txId)).toBe("failed");
    expect((await profileGrant(userId)).premiumUntil).toBeNull();
  });

  it("completed переживает expires_at: поздний replay → duplicate, доступ сохранён", async () => {
    const userId = await seedUser();
    const txId = await seedPending(userId, {
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(await applyCompletedPayment("payme", txId)).toBe("applied");

    // Чекаут «протух» уже ПОСЛЕ применения — идемпотентность не ломается.
    await sql`UPDATE payment SET expires_at = now() - interval '1 hour'
      WHERE provider = 'payme' AND provider_transaction_id = ${txId}`;

    expect(await applyCompletedPayment("payme", txId)).toBe("duplicate");
    expect(await paymentStatus(txId)).toBe("completed");
    expect((await profileGrant(userId)).premiumUntil).not.toBeNull();
  });
});

describe("схемные инварианты", () => {
  it("UNIQUE(provider, provider_transaction_id) — реальный constraint, не только app-логика", async () => {
    const userId = await seedUser();
    const txId = await seedPending(userId, { txId: "dbtest_dup_tx" });

    await expect(seedPending(userId, { txId })).rejects.toMatchObject({
      code: "23505",
    });
  });
});
