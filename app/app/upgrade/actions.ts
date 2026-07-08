"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import { payment } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { captureServer } from "@/lib/analytics/server";
import { findPlan, PENDING_TTL_MS } from "@/lib/payments/plans";
import { paymentsLive } from "@/lib/payments";
import type { PaymentProviderKey } from "@/env";

const VALID_PROVIDERS: readonly PaymentProviderKey[] = ["payme", "click", "uzum"];

function isProvider(v: string): v is PaymentProviderKey {
  return (VALID_PROVIDERS as readonly string[]).includes(v);
}

/**
 * Инициировать оплату (BRIEF §4.8 / §11). Создаёт ТОЛЬКО PENDING-строку платежа —
 * доступ НЕ выдаётся здесь: продлевает premium_until/tier исключительно
 * completed-вебхук (applyCompletedPayment). Затем редиректит на стаб-чекаут.
 *
 * SERVER-ONLY: пишет payment owner-клиентом (`@/db`, обходит RLS), цену берёт из
 * findPlan() на сервере — клиент не диктует сумму. Реальный провайдерский
 * transaction_id придёт в вебхуке; до онбординга генерим стаб-UUID как
 * idempotency-ключ, чтобы и PENDING, и последующий вебхук сошлись на одной строке.
 */
export async function initiatePayment(formData: FormData): Promise<void> {
  const provider = String(formData.get("provider") ?? "");
  const tier = String(formData.get("tier") ?? "");
  const months = Number(formData.get("months") ?? NaN);

  const user = await requireUser();

  // Валидация ДО гейта: гейт зависит от провайдера, а события воронки не должны
  // уносить сырой client-input в телеметрию — только канонические значения плана.
  if (!isProvider(provider)) redirect("/app/upgrade?error=provider");
  const plan = findPlan(tier, months);
  if (!plan) redirect("/app/upgrade?error=plan");

  // Гейт §12: без мерчант-ключа ЭТОГО провайдера в production платёжный флоу
  // недоступен — вебхук всё равно fail-closed (400). Fail-closed ЗДЕСЬ: не плодим
  // pending-строку в тупик, уводим на pricing с честным статусом. checkout_blocked
  // — в after() (не блокирует редирект, как checkout_start).
  if (!paymentsLive(provider)) {
    after(() =>
      captureServer("checkout_blocked", user.id, {
        provider,
        tier: plan.tier,
        period_months: plan.months,
        reason: "payments_unavailable",
      }),
    );
    redirect("/app/upgrade?error=unavailable");
  }

  // Стаб transaction_id — он же idempotency-ключ для будущего вебхука. При
  // реальном онбординге сюда ляжет id, который вернёт провайдер на init-вызов.
  const providerTransactionId = `stub_${randomUUID()}`;

  const [row] = await db
    .insert(payment)
    .values({
      userId: user.id,
      provider,
      providerTransactionId,
      tier: plan.tier,
      periodMonths: plan.months,
      amount: plan.amount,
      currency: plan.currency,
      status: "pending",
      // Срок жизни чекаута: устаревший pending webhook не применит (§4.8).
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    })
    .returning({ id: payment.id });

  // checkout_start — событие воронки (§11), best-effort в after() (как test_start),
  // не блокирует редирект. Значения из доверенного findPlan(), не с клиента.
  after(() =>
    captureServer("checkout_start", user.id, {
      provider,
      tier: plan.tier,
      period_months: plan.months,
      amount: plan.amount,
    }),
  );

  // Страница чекаута — зона ответственности Agent U; просто уводим туда с pid.
  redirect(`/app/upgrade/checkout?pid=${row!.id}`);
}

/**
 * Waitlist-лайт (§12): пока оплата не запущена, кнопка на pricing регистрирует
 * интерес к платному тарифу. Никакой новой таблицы и никакого owner-path — это
 * только продуктовая телеметрия (спрос до онбординга мерчанта). distinctId =
 * user.id (сервер-авторитетно). tier/months нормализуются через findPlan — сырой
 * client-input в телеметрию не уходит (кривые значения схлопываются в unknown).
 */
export async function joinPaymentWaitlist(input: {
  tier: string;
  months: number;
}): Promise<void> {
  const user = await requireUser();
  const plan = findPlan(String(input.tier), Number(input.months));
  await captureServer("payment_waitlist", user.id, {
    tier: plan?.tier ?? "unknown",
    period_months: plan?.months ?? 0,
  });
}
