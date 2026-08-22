import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Юнит-тесты волны 0a (платёжные инварианты) на initiatePayment/preorderPlan
// (BRIEF §4.8/§11). Мок-паттерн — эталон src/lib/exam/access.test.ts +
// app/app/reading/[id]/actions.test.ts: @/db мокается через vi.hoisted-функцию
// (insert-цепочка захватывает .values() аргумент замыканием, терминал резолвит
// Promise), next/navigation.redirect бросает СВОЮ ошибку с адресом (assert
// точного target), next/server.after копит промисы колбэков в afterPromises —
// afterEach их дожидается (наблюдает rejection, не даёт утечь в соседний тест).
// @/lib/payments/plans НЕ мокается — findPlan()/PENDING_TTL_MS берём из
// РЕАЛЬНОГО модуля, чтобы тест не пинил цену литералом и ловил рассинхрон
// с каталогом тарифов.
const { insertFn } = vi.hoisted(() => ({ insertFn: vi.fn() }));
const requireUserFn = vi.hoisted(() => vi.fn());
const paymentsLiveFn = vi.hoisted(() => vi.fn());
const captureFn = vi.hoisted(() => vi.fn());
const logErrorFn = vi.hoisted(() => vi.fn());
const revalidatePathFn = vi.hoisted(() => vi.fn());
const afterPromises = vi.hoisted(() => [] as Promise<unknown>[]);
const redirectFn = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
);

vi.mock("@/db", () => ({
  db: { insert: (...a: unknown[]) => insertFn(...a) },
}));
vi.mock("@/lib/auth", () => ({ requireUser: requireUserFn }));
vi.mock("@/lib/payments", () => ({ paymentsLive: paymentsLiveFn }));
vi.mock("next/navigation", () => ({ redirect: redirectFn }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathFn }));
vi.mock("@/lib/analytics/server", () => ({ captureServer: captureFn }));
vi.mock("@/lib/monitoring/log-error", () => ({ logError: logErrorFn }));
// after() вне request-скоупа Next бросает; в юнитах откладываем колбэк на микротаск и
// СОБИРАЕМ его промис (как реальный after() откладывает выполнение относительно ответа).
// afterEach дожидается всех промисов -> reject валит свой тест, splice() чистит очередь.
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    afterPromises.push(Promise.resolve().then(fn));
  },
}));

import { initiatePayment, preorderPlan } from "./actions";
import { findPlan, PENDING_TTL_MS } from "@/lib/payments/plans";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

// (a) initiatePayment insert: .insert(payment).values(v).returning({id}) -> Promise<rows>.
// Захватываем v замыканием, чтобы ассертить поля цены/срока/статуса после вызова.
function withPaymentInsert(rows: Array<{ id: string }>) {
  let captured: Record<string, unknown> | undefined;
  insertFn.mockReturnValueOnce({
    values: (v: Record<string, unknown>) => {
      captured = v;
      return { returning: () => Promise.resolve(rows) };
    },
  });
  return () => captured!;
}

// (b) preorderPlan insert: .insert(preorder).values(v).onConflictDoNothing() -> Promise<void>.
// onConflictDoNothing — отдельный vi.fn(), чтобы явно ассертить, что цепочка его вызывает
// (не просто .values() и всё), и чтобы смоделировать сбой INSERT (кейс 9).
function withPreorderInsert(opts?: { reject?: boolean }) {
  let captured: Record<string, unknown> | undefined;
  const onConflictDoNothing = vi.fn(() =>
    opts?.reject ? Promise.reject(new Error("insert failed")) : Promise.resolve(undefined),
  );
  insertFn.mockReturnValueOnce({
    values: (v: Record<string, unknown>) => {
      captured = v;
      return { onConflictDoNothing };
    },
  });
  return { getValues: () => captured!, onConflictDoNothing };
}

beforeEach(() => {
  insertFn.mockReset();
  requireUserFn.mockReset().mockResolvedValue({ id: "u1" });
  paymentsLiveFn.mockReset();
  captureFn.mockClear();
  logErrorFn.mockClear();
  revalidatePathFn.mockClear();
  redirectFn.mockClear();
});

afterEach(async () => {
  await Promise.all(afterPromises.splice(0));
  vi.useRealTimers();
});

describe("initiatePayment", () => {
  it("невалидный provider -> redirect ?error=provider, insert не вызывается", async () => {
    await expect(
      initiatePayment(fd({ provider: "stripe", tier: "premium", months: "1" })),
    ).rejects.toThrow("REDIRECT:/app/upgrade?error=provider");
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("валидный provider + несуществующий план (premium, 3 мес.) -> redirect ?error=plan, insert не вызывается", async () => {
    expect(findPlan("premium", 3)).toBeUndefined(); // такого плана нет в каталоге
    await expect(
      initiatePayment(fd({ provider: "payme", tier: "premium", months: "3" })),
    ).rejects.toThrow("REDIRECT:/app/upgrade?error=plan");
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("paymentsLive -> false: redirect ?error=unavailable, insert не вызывается, checkout_blocked после слива after()", async () => {
    paymentsLiveFn.mockReturnValueOnce(false);
    const plan = findPlan("premium", 1)!;
    await expect(
      initiatePayment(fd({ provider: "payme", tier: "premium", months: "1" })),
    ).rejects.toThrow("REDIRECT:/app/upgrade?error=unavailable");
    expect(insertFn).not.toHaveBeenCalled();
    expect(captureFn).toHaveBeenCalledWith("checkout_blocked", "u1", {
      provider: "payme",
      tier: plan.tier,
      period_months: plan.months,
      reason: "payments_unavailable",
    });
  });

  it("paymentsLive зовётся С провайдером из формы (гейт по-провайдерный)", async () => {
    paymentsLiveFn.mockReturnValueOnce(false); // ветка неважна — интересует только аргумент
    await expect(
      initiatePayment(fd({ provider: "uzum", tier: "premium", months: "1" })),
    ).rejects.toThrow("REDIRECT:/app/upgrade?error=unavailable");
    expect(paymentsLiveFn).toHaveBeenCalledWith("uzum");
  });

  it("happy path: pending-строка из findPlan(), redirect на checkout, checkout_start после слива after()", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    paymentsLiveFn.mockReturnValueOnce(true);
    const getValues = withPaymentInsert([{ id: "pid-1" }]);
    const plan = findPlan("premium", 1)!;

    await expect(
      initiatePayment(fd({ provider: "payme", tier: "premium", months: "1" })),
    ).rejects.toThrow("REDIRECT:/app/upgrade/checkout?pid=pid-1");

    const values = getValues();
    expect(values.userId).toBe("u1"); // из requireUser(), не из FormData
    expect(values.amount).toBe(plan.amount);
    expect(values.currency).toBe(plan.currency);
    expect(values.status).toBe("pending");
    expect(String(values.providerTransactionId)).toMatch(/^stub_/);
    expect((values.expiresAt as Date).getTime()).toBe(now.getTime() + PENDING_TTL_MS);

    expect(captureFn).toHaveBeenCalledWith("checkout_start", "u1", {
      provider: "payme",
      tier: plan.tier,
      period_months: plan.months,
      amount: plan.amount,
    });
  });
});

describe("preorderPlan", () => {
  it("paymentsLive -> true: {ok:false}, insert не вызывается (early-bird задним числом запрещён)", async () => {
    paymentsLiveFn.mockReturnValueOnce(true);
    await expect(
      preorderPlan({ tier: "premium", months: 1, sourcePage: "pricing" }),
    ).resolves.toEqual({ ok: false });
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("несуществующий план -> {ok:false}, insert не вызывается", async () => {
    paymentsLiveFn.mockReturnValueOnce(false);
    expect(findPlan("premium", 3)).toBeUndefined();
    await expect(
      preorderPlan({ tier: "premium", months: 3, sourcePage: "pricing" }),
    ).resolves.toEqual({ ok: false });
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("happy path: amount = earlyBirdAmount (НЕ amount), onConflictDoNothing вызван, preorder-событие, revalidate, {ok:true}", async () => {
    paymentsLiveFn.mockReturnValueOnce(false);
    const plan = findPlan("ultra", 12)!;
    const { getValues, onConflictDoNothing } = withPreorderInsert();

    await expect(
      preorderPlan({ tier: "ultra", months: 12, sourcePage: "pricing" }),
    ).resolves.toEqual({ ok: true });

    const values = getValues();
    expect(values.userId).toBe("u1");
    expect(values.tier).toBe(plan.tier);
    expect(values.periodMonths).toBe(plan.months);
    expect(values.amount).toBe(plan.earlyBirdAmount); // НЕ plan.amount
    expect(values.currency).toBe(plan.currency);
    expect(onConflictDoNothing).toHaveBeenCalled();

    expect(captureFn).toHaveBeenCalledWith("preorder", "u1", {
      tier: plan.tier,
      period_months: plan.months,
      source_page: "pricing",
    });
    expect(revalidatePathFn).toHaveBeenCalledWith("/app/upgrade");
  });

  it("insert бросает -> {ok:false}, logError вызван, captureServer НЕ вызван (строки нет — метрике не врём)", async () => {
    paymentsLiveFn.mockReturnValueOnce(false);
    const plan = findPlan("premium", 1)!;
    withPreorderInsert({ reject: true });

    await expect(
      preorderPlan({ tier: "premium", months: 1, sourcePage: "pricing" }),
    ).resolves.toEqual({ ok: false });

    expect(logErrorFn).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "server",
        message: "preorderPlan insert failed",
        context: expect.objectContaining({
          op: "preorderPlan",
          userId: "u1",
          tier: plan.tier,
          periodMonths: plan.months,
        }),
      }),
    );
    expect(captureFn).not.toHaveBeenCalled();
  });

  it("sourcePage вне whitelist ('evil') -> событие несёт fallback source_page:'upgrade', не сырую строку", async () => {
    paymentsLiveFn.mockReturnValueOnce(false);
    const plan = findPlan("premium", 1)!;
    withPreorderInsert();

    await expect(
      preorderPlan({ tier: "premium", months: 1, sourcePage: "evil" }),
    ).resolves.toEqual({ ok: true });

    expect(captureFn).toHaveBeenCalledWith("preorder", "u1", {
      tier: plan.tier,
      period_months: plan.months,
      source_page: "upgrade",
    });
  });
});
