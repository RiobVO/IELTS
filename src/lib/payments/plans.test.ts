// Юнит-тесты каталога тарифов (BRIEF §4.8). Контракт: поиск по паре (tier, months).
// Сумму НЕ проверяем — это плейсхолдер-данные, а не поведение функции.
import { describe, it, expect } from "vitest";
import { PLANS, findPlan, isPaymentExpired, validateEntitlement, stacksOnExistingPeriod, paymentFailureReason, reconcileClaims } from "./plans";

describe("findPlan", () => {
  it("возвращает тариф, совпадающий и по tier, и по months", () => {
    const premiumMonthly = findPlan("premium", 1);
    expect(premiumMonthly).toBeDefined();
    expect(premiumMonthly?.tier).toBe("premium");
    expect(premiumMonthly?.months).toBe(1);
    expect(premiumMonthly?.currency).toBe("UZS");

    const ultraAnnual = findPlan("ultra", 12);
    expect(ultraAnnual?.tier).toBe("ultra");
    expect(ultraAnnual?.months).toBe(12);
  });

  it("различает тарифы одного tier по months (не матчит только по tier)", () => {
    expect(findPlan("premium", 1)?.months).toBe(1);
    expect(findPlan("premium", 12)?.months).toBe(12);
  });

  it("возвращает undefined для комбинации не из каталога", () => {
    expect(findPlan("premium", 3)).toBeUndefined();
    expect(findPlan("ultra", 6)).toBeUndefined();
    expect(findPlan("basic", 1)).toBeUndefined(); // basic не покупается
    expect(findPlan("", 0)).toBeUndefined();
  });
});

// Анти-фрод инвариант вебхука (сольный путь выдачи доступа). Доступ выдаётся,
// только если (tier, срок, сумма) точно совпали с продаваемым планом.
describe("validateEntitlement", () => {
  it("ok, когда tier + months + amount совпали с планом каталога", () => {
    const premiumMonthly = findPlan("premium", 1);
    expect(premiumMonthly).toBeDefined();
    expect(
      validateEntitlement({
        tier: "premium",
        periodMonths: 1,
        amount: premiumMonthly!.amount,
      }),
    ).toBe(true);
  });

  it("invalid при несовпадении суммы — ключевая защита от подделки", () => {
    const ultraAnnual = findPlan("ultra", 12);
    expect(ultraAnnual).toBeDefined();
    // Корректная пара, но заниженная сумма (частичная оплата / подделка тела).
    expect(
      validateEntitlement({
        tier: "ultra",
        periodMonths: 12,
        amount: ultraAnnual!.amount - 1,
      }),
    ).toBe(false);
    // И завышенная сумма тоже не проходит — нужно ТОЧНОЕ совпадение.
    expect(
      validateEntitlement({
        tier: "ultra",
        periodMonths: 12,
        amount: ultraAnnual!.amount + 1,
      }),
    ).toBe(false);
  });

  it("invalid для несуществующей пары (tier, months) при любой сумме", () => {
    // Непроданный срок: даже если сумма равна цене реального плана — false,
    // т.к. сам план не найден.
    const anyAmount = PLANS[0]!.amount;
    expect(
      validateEntitlement({ tier: "premium", periodMonths: 3, amount: anyAmount }),
    ).toBe(false);
    expect(
      validateEntitlement({ tier: "basic", periodMonths: 1, amount: anyAmount }),
    ).toBe(false);
  });
});

// Продление срока: стекать поверх остатка можно только на том же тарифе (#8).
describe("stacksOnExistingPeriod", () => {
  it("true только когда покупаемый тариф совпал с текущим", () => {
    expect(stacksOnExistingPeriod("premium", "premium")).toBe(true);
    expect(stacksOnExistingPeriod("ultra", "ultra")).toBe(true);
  });
  it("false при смене тарифа — блокирует дешёвый Ultra-поверх-Premium и потерю Ultra", () => {
    expect(stacksOnExistingPeriod("premium", "ultra")).toBe(false); // дешёвый апгрейд
    expect(stacksOnExistingPeriod("ultra", "premium")).toBe(false); // downgrade не наследует срок
  });
  it("false для NULL / basic текущего тарифа (первая покупка)", () => {
    expect(stacksOnExistingPeriod(null, "premium")).toBe(false);
    expect(stacksOnExistingPeriod("basic", "premium")).toBe(false);
    expect(stacksOnExistingPeriod("basic", "ultra")).toBe(false);
  });
});

// Нормализация исхода applyCompletedPayment → причина события payment_failed (§11).
describe("paymentFailureReason", () => {
  it("неуспешные исходы дают причину для воронки", () => {
    expect(paymentFailureReason("invalid")).toBe("invalid");
    expect(paymentFailureReason("expired")).toBe("expired");
    expect(paymentFailureReason("error")).toBe("error");
  });
  it("успех / дубль / not_found события не порождают (null)", () => {
    expect(paymentFailureReason("applied")).toBeNull();
    expect(paymentFailureReason("duplicate")).toBeNull();
    expect(paymentFailureReason("not_found")).toBeNull();
  });
});

// Срок жизни PENDING-платежа: устаревший незавершённый чекаут нельзя применить.
describe("isPaymentExpired", () => {
  const now = new Date("2026-06-25T12:00:00.000Z");
  it("true, когда expires_at в прошлом", () => {
    expect(isPaymentExpired(new Date("2026-06-25T11:59:59.000Z"), now)).toBe(true);
    expect(isPaymentExpired("2026-06-25T10:00:00.000Z", now)).toBe(true);
  });
  it("false, когда expires_at в будущем или ровно сейчас", () => {
    expect(isPaymentExpired(new Date("2026-06-25T12:00:01.000Z"), now)).toBe(false);
    expect(isPaymentExpired(new Date(now), now)).toBe(false); // ровно now — ещё жив
  });
  it("false для null (legacy-строки до 0020) — не ломаем старые pending", () => {
    expect(isPaymentExpired(null, now)).toBe(false);
  });
  it("false для нечитаемой даты — не отклоняем по мусору", () => {
    expect(isPaymentExpired("not-a-date", now)).toBe(false);
  });
});

// Сверка подписанных claims вебхука с доверенной pending-строкой (волна 0a).
// Суммы берём из каталога через findPlan — не пиним ценами-литералами.
describe("reconcileClaims", () => {
  const plan = findPlan("premium", 1)!;
  const pending = { amount: plan.amount, currency: plan.currency };

  it("ok:true при точном совпадении amount+currency и status=completed", () => {
    expect(
      reconcileClaims(pending, {
        amount: pending.amount,
        currency: pending.currency,
        status: "completed",
      }),
    ).toEqual({ ok: true });
  });

  it("missing_field, если отсутствует amount / currency / status по отдельности", () => {
    expect(
      reconcileClaims(pending, { currency: pending.currency, status: "completed" }),
    ).toEqual({ ok: false, reason: "missing_field" });
    expect(
      reconcileClaims(pending, { amount: pending.amount, status: "completed" }),
    ).toEqual({ ok: false, reason: "missing_field" });
    expect(
      reconcileClaims(pending, { amount: pending.amount, currency: pending.currency }),
    ).toEqual({ ok: false, reason: "missing_field" });
  });

  it("not_completed для status pending/failed/cancelled (сумма и валюта совпадают)", () => {
    for (const status of ["pending", "failed", "cancelled"]) {
      expect(
        reconcileClaims(pending, {
          amount: pending.amount,
          currency: pending.currency,
          status,
        }),
      ).toEqual({ ok: false, reason: "not_completed" });
    }
  });

  it("amount_mismatch при недоплате и переплате (currency+status верны)", () => {
    expect(
      reconcileClaims(pending, {
        amount: pending.amount - 1,
        currency: pending.currency,
        status: "completed",
      }),
    ).toEqual({ ok: false, reason: "amount_mismatch" });
    expect(
      reconcileClaims(pending, {
        amount: pending.amount + 1,
        currency: pending.currency,
        status: "completed",
      }),
    ).toEqual({ ok: false, reason: "amount_mismatch" });
  });

  it("currency_mismatch при чужой валюте и верной сумме", () => {
    expect(
      reconcileClaims(pending, {
        amount: pending.amount,
        currency: "USD",
        status: "completed",
      }),
    ).toEqual({ ok: false, reason: "currency_mismatch" });
  });

  // Порядок проверок STATUS-FIRST: status -> presence(amount/currency) -> amount
  // -> currency. cancelled-событие с неверной суммой обязано дать not_completed,
  // а не amount_mismatch.
  it("порядок проверок: status раньше amount — cancelled с неверной суммой даёт not_completed", () => {
    expect(
      reconcileClaims(pending, {
        amount: pending.amount + 1,
        currency: pending.currency,
        status: "cancelled",
      }),
    ).toEqual({ ok: false, reason: "not_completed" });
  });

  // Codex-ревью 0a (major): провайдер легитимно шлёт отмену/ожидание БЕЗ суммы —
  // событие только со status не должно улетать в missing_field/500-ретраи.
  // Presence amount/currency обязателен ТОЛЬКО на грант-пути (completed).
  it("status-only событие (без amount/currency): не-completed даёт not_completed, completed — missing_field", () => {
    expect(reconcileClaims(pending, { status: "cancelled" })).toEqual({
      ok: false,
      reason: "not_completed",
    });
    expect(reconcileClaims(pending, { status: "pending" })).toEqual({
      ok: false,
      reason: "not_completed",
    });
    // Грант-путь остаётся fail-closed: completed без суммы — ошибка адаптера.
    expect(reconcileClaims(pending, { status: "completed" })).toEqual({
      ok: false,
      reason: "missing_field",
    });
  });
});
