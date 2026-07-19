// Юнит-тесты платёжного seam-а (BRIEF §4.8/§11, волна 0a — платёжные инварианты).
// Мокаем @/env (paymentSecret — гейт stub/real-режима), @/db (select/update-цепочки,
// tx делит очереди с db.*, стиль src/lib/exam/access.test.ts) и телеметрию
// (captureServer/captureError/logError), чтобы проверить applyCompletedPayment и
// verifyWebhook в изоляции от реальной БД/PostHog/Sentry. reconcileClaims/
// validateEntitlement/isPaymentExpired как чистые функции покрыты в plans.test.ts —
// здесь пиним ТОЛЬКО их проводку внутри транзакции (порядок веток, идемпотентность,
// какие мутации/события происходят на каждом исходе). Байтовые кейсы HMAC-подписи —
// в webhook-signature.test.ts, здесь не дублируем.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

const paymentSecretFn = vi.hoisted(() => vi.fn());
const { select, update } = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }));
const captureFn = vi.hoisted(() => vi.fn());
const captureError = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());

vi.mock("@/env", () => ({ paymentSecret: (...a: unknown[]) => paymentSecretFn(...a) }));
// tx делит select/update-очередь с db.* (тот же приём, что persist.test.ts/access.test.ts):
// реальный код зовёт то db.select, то tx.select — порядок mockReturnValueOnce идёт строго
// в порядке РЕАЛЬНЫХ вызовов внутри applyCompletedPayment.
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => select(...a),
    update: (...a: unknown[]) => update(...a),
    transaction: (cb: (tx: unknown) => unknown) =>
      cb({
        select: (...a: unknown[]) => select(...a),
        update: (...a: unknown[]) => update(...a),
      }),
  },
}));
vi.mock("@/lib/analytics/server", () => ({ captureServer: captureFn }));
vi.mock("@/lib/monitoring/capture", () => ({ captureError }));
vi.mock("@/lib/monitoring/log-error", () => ({ logError }));

import { applyCompletedPayment, verifyWebhook } from "./index";
import { findPlan } from "./plans";

// (a) payment-строка: .select().from().where().limit() -> Promise<rows>.
const rowChain = (rows: unknown[]) => ({
  from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
});
// (a2) profile-tier ПОД ЛОКОМ (FOR UPDATE — прод-баг #5, stack-решение сериализуется):
// .select().from().where().limit().for() -> Promise<rows>, как lockChain в access.test.ts.
const lockChain = (rows: unknown[]) => ({
  from: () => ({
    where: () => ({ limit: () => ({ for: () => Promise.resolve(rows) }) }),
  }),
});
// (b) single-fire failed-mark (expired/invalid): .update().set().where() -> Promise<void>, без .returning().
const failMarkChain = () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) });
// (c) claim (pending->completed) / grant (profile update): .update().set().where().returning() -> Promise<rows>.
const returningChain = (rows: unknown[]) => ({
  set: () => ({ where: () => ({ returning: () => Promise.resolve(rows) }) }),
});

// Валидная пара каталога — цену НЕ пиним литералом, берём из findPlan.
const plan = findPlan("premium", 1)!;
function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    tier: "premium",
    periodMonths: 1,
    amount: plan.amount,
    currency: "UZS",
    status: "pending",
    expiresAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  select.mockReset();
  update.mockReset();
  captureFn.mockClear();
  captureError.mockClear();
  logError.mockClear();
  paymentSecretFn.mockReset();
  // Дефолт: стаб-режим (нет мерчант-ключа) — большинство кейсов явно не переопределяют.
  paymentSecretFn.mockReturnValue(null);
});

afterEach(() => {
  // isProduction() читает process.env напрямую (VERCEL_ENV/NODE_ENV) — под vitest
  // NODE_ENV="test", поэтому дефолт non-prod; prod-кейсы стабят VERCEL_ENV и обязаны
  // быть откачены, иначе окружение потечёт в соседний тест.
  vi.unstubAllEnvs();
});

describe("verifyWebhook", () => {
  it("стаб-режим вне production (нет ключа) -> true, без logError", async () => {
    const req = new Request("http://x", { method: "POST" });
    await expect(verifyWebhook("payme", req, "{}")).resolves.toBe(true);
    expect(logError).not.toHaveBeenCalled();
  });

  it("production без ключа -> false (fail closed) + logError", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const req = new Request("http://x", { method: "POST" });
    await expect(verifyWebhook("payme", req, "{}")).resolves.toBe(false);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("ключ есть, заголовок x-payment-signature отсутствует -> false + logError", async () => {
    paymentSecretFn.mockReturnValue("secret");
    const req = new Request("http://x", { method: "POST" });
    await expect(verifyWebhook("payme", req, "{}")).resolves.toBe(false);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("ключ есть, битая подпись -> false", async () => {
    paymentSecretFn.mockReturnValue("secret");
    const req = new Request("http://x", {
      method: "POST",
      headers: { "x-payment-signature": "deadbeef" },
    });
    await expect(verifyWebhook("payme", req, '{"a":1}')).resolves.toBe(false);
  });

  it("ключ есть, валидная подпись, но тело ИЗМЕНЕНО после подписания -> false", async () => {
    paymentSecretFn.mockReturnValue("secret");
    const signedBody = '{"a":1}';
    const signature = createHmac("sha256", "secret").update(signedBody).digest("hex");
    const req = new Request("http://x", {
      method: "POST",
      headers: { "x-payment-signature": signature },
    });
    await expect(verifyWebhook("payme", req, signedBody + "x")).resolves.toBe(false);
  });

  it("ключ есть, корректная подпись от того же тела -> true", async () => {
    paymentSecretFn.mockReturnValue("secret");
    const body = '{"a":1}';
    const signature = createHmac("sha256", "secret").update(body).digest("hex");
    const req = new Request("http://x", {
      method: "POST",
      headers: { "x-payment-signature": signature },
    });
    await expect(verifyWebhook("payme", req, body)).resolves.toBe(true);
  });
});

describe("applyCompletedPayment — stub-режим (нет мерчант-ключа)", () => {
  it("платёжной строки нет -> not_found; update и captureFn не вызваны", async () => {
    select.mockReturnValueOnce(rowChain([]));
    await expect(applyCompletedPayment("payme", "tx1")).resolves.toBe("not_found");
    expect(update).not.toHaveBeenCalled();
    expect(captureFn).not.toHaveBeenCalled();
  });

  it("строка НЕ pending (completed/failed) -> duplicate; update не вызван (идемпотентный ack, без payment_failed)", async () => {
    select.mockReturnValueOnce(rowChain([pendingRow({ status: "completed" })]));
    await expect(applyCompletedPayment("payme", "tx1")).resolves.toBe("duplicate");

    select.mockReturnValueOnce(rowChain([pendingRow({ status: "failed" })]));
    await expect(applyCompletedPayment("payme", "tx2")).resolves.toBe("duplicate");

    expect(update).not.toHaveBeenCalled();
    expect(captureFn).not.toHaveBeenCalled();
  });

  it("pending + expiresAt в прошлом -> expired; ровно один update (failMark); payment_failed reason=expired", async () => {
    const past = new Date(Date.now() - 1000);
    select.mockReturnValueOnce(rowChain([pendingRow({ expiresAt: past })]));
    update.mockReturnValueOnce(failMarkChain());

    await expect(applyCompletedPayment("payme", "tx1")).resolves.toBe("expired");
    expect(update).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith("payment_failed", "u1", {
      provider: "payme",
      reason: "expired",
    });
  });

  it("pending + сумма расходится с каталогом (findPlan) -> invalid + failMark + payment_failed reason=invalid", async () => {
    select.mockReturnValueOnce(rowChain([pendingRow({ amount: plan.amount + 1 })]));
    update.mockReturnValueOnce(failMarkChain());

    await expect(applyCompletedPayment("payme", "tx1")).resolves.toBe("invalid");
    expect(update).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith("payment_failed", "u1", {
      provider: "payme",
      reason: "invalid",
    });
  });

  it("happy applied: profile.tier === row.tier -> applied; два returning-update; upgrade-событие", async () => {
    select
      .mockReturnValueOnce(rowChain([pendingRow()])) // payment-row
      .mockReturnValueOnce(lockChain([{ tier: "premium" }])); // profile-tier FOR UPDATE
    update
      .mockReturnValueOnce(returningChain([{ id: "pay1" }])) // claim pending->completed
      .mockReturnValueOnce(returningChain([{ id: "u1" }])); // grant profile

    await expect(applyCompletedPayment("payme", "tx1")).resolves.toBe("applied");
    expect(update).toHaveBeenCalledTimes(2);
    expect(captureFn).toHaveBeenCalledWith("upgrade", "u1", {
      provider: "payme",
      tier: "premium",
      period_months: 1,
    });
  });

  it("claim проигран гонкой (returning []) -> duplicate; grant-update НЕ вызван", async () => {
    select
      .mockReturnValueOnce(rowChain([pendingRow()]))
      .mockReturnValueOnce(lockChain([{ tier: "premium" }]));
    update.mockReturnValueOnce(returningChain([])); // claim не досталась нам

    await expect(applyCompletedPayment("payme", "tx1")).resolves.toBe("duplicate");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("tx бросает (первый select падает) -> error; logError+captureError вызваны, payment_failed НЕ шлётся (владелец неизвестен)", async () => {
    select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.reject(new Error("db down")) }) }),
    });

    await expect(applyCompletedPayment("payme", "tx1")).resolves.toBe("error");
    expect(logError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureFn).not.toHaveBeenCalled();
  });

  it("стаб-режим игнорирует claims (даже заведомо неверные) -> applied — reconcile гейтится ИСКЛЮЧИТЕЛЬНО мерчант-ключом", async () => {
    select
      .mockReturnValueOnce(rowChain([pendingRow()]))
      .mockReturnValueOnce(lockChain([{ tier: "premium" }]));
    update
      .mockReturnValueOnce(returningChain([{ id: "pay1" }]))
      .mockReturnValueOnce(returningChain([{ id: "u1" }]));

    const outcome = await applyCompletedPayment("payme", "tx1", {
      amount: plan.amount + 999,
      currency: "USD",
      status: "pending",
    });
    expect(outcome).toBe("applied");
  });

  it("guard нулевого grant (profile исчез под локом) -> throw внутри tx -> error; logError+captureError; payment_failed reason=error", async () => {
    select
      .mockReturnValueOnce(rowChain([pendingRow()]))
      .mockReturnValueOnce(lockChain([{ tier: "premium" }]));
    update
      .mockReturnValueOnce(returningChain([{ id: "pay1" }])) // claim прошла
      .mockReturnValueOnce(returningChain([])); // grant вернул 0 строк

    await expect(applyCompletedPayment("payme", "tx1")).resolves.toBe("error");
    expect(logError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith("payment_failed", "u1", {
      provider: "payme",
      reason: "error",
    });
  });
});

describe("applyCompletedPayment — real-режим (мерчант-ключ задан, reconcileClaims активен)", () => {
  beforeEach(() => {
    paymentSecretFn.mockReturnValue("secret");
  });

  it("claims={} -> error (missing_field, fail closed); update НЕ вызван; logError с missing signed claim; payment_failed reason=error", async () => {
    select.mockReturnValueOnce(rowChain([pendingRow()]));

    await expect(applyCompletedPayment("payme", "tx1", {})).resolves.toBe("error");
    expect(update).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("missing signed claim"),
      }),
    );
    expect(captureFn).toHaveBeenCalledWith("payment_failed", "u1", {
      provider: "payme",
      reason: "error",
    });
  });

  it("claims: amount+currency верны, status=pending -> ignored; update и payment_failed НЕ вызваны (charge ещё может завершиться)", async () => {
    select.mockReturnValueOnce(rowChain([pendingRow()]));

    const outcome = await applyCompletedPayment("payme", "tx1", {
      amount: plan.amount,
      currency: "UZS",
      status: "pending",
    });
    expect(outcome).toBe("ignored");
    expect(update).not.toHaveBeenCalled();
    expect(captureFn).not.toHaveBeenCalled();
  });

  // Codex-ревью 0a (major): провайдер уведомляет об отмене БЕЗ суммы — событие
  // только со status обязано дать ignored (no-op ack), а не missing_field/500.
  it("claims только со status=cancelled (без amount/currency) -> ignored, без мутаций и телеметрии", async () => {
    select.mockReturnValueOnce(rowChain([pendingRow()]));

    const outcome = await applyCompletedPayment("payme", "tx1", {
      status: "cancelled",
    });
    expect(outcome).toBe("ignored");
    expect(update).not.toHaveBeenCalled();
    expect(captureFn).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  // Codex-ревью 0a (minor): пин порядка веток — reconcile НЕ проглатывает expiry.
  // Полные валидные claims на протухшей строке дают expired (+failMark), не applied.
  it("real-режим: валидные completed-claims на протухшем pending -> expired + failMark (reconcile не обходит expiry)", async () => {
    select.mockReturnValueOnce(
      rowChain([pendingRow({ expiresAt: new Date(Date.now() - 1000) })]),
    );
    update.mockReturnValueOnce(failMarkChain());

    const outcome = await applyCompletedPayment("payme", "tx1", {
      amount: plan.amount,
      currency: "UZS",
      status: "completed",
    });
    expect(outcome).toBe("expired");
    expect(update).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith("payment_failed", "u1", {
      provider: "payme",
      reason: "expired",
    });
  });

  it("claims: amount ≠ row.amount -> invalid + failMark + payment_failed reason=invalid", async () => {
    select.mockReturnValueOnce(rowChain([pendingRow()]));
    update.mockReturnValueOnce(failMarkChain());

    const outcome = await applyCompletedPayment("payme", "tx1", {
      amount: plan.amount - 1,
      currency: "UZS",
      status: "completed",
    });
    expect(outcome).toBe("invalid");
    expect(update).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith("payment_failed", "u1", {
      provider: "payme",
      reason: "invalid",
    });
  });

  it("claims: currency ≠ row.currency при верной сумме и status=completed -> invalid", async () => {
    select.mockReturnValueOnce(rowChain([pendingRow()]));
    update.mockReturnValueOnce(failMarkChain());

    const outcome = await applyCompletedPayment("payme", "tx1", {
      amount: plan.amount,
      currency: "USD",
      status: "completed",
    });
    expect(outcome).toBe("invalid");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("claims полностью совпали (amount+currency) + status=completed -> доходит до applied", async () => {
    select
      .mockReturnValueOnce(rowChain([pendingRow()]))
      .mockReturnValueOnce(lockChain([{ tier: "premium" }]));
    update
      .mockReturnValueOnce(returningChain([{ id: "pay1" }]))
      .mockReturnValueOnce(returningChain([{ id: "u1" }]));

    const outcome = await applyCompletedPayment("payme", "tx1", {
      amount: plan.amount,
      currency: "UZS",
      status: "completed",
    });
    expect(outcome).toBe("applied");
  });
});
