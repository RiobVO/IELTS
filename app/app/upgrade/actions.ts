"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { payment } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { findPlan, PENDING_TTL_MS } from "@/lib/payments/plans";
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

  if (!isProvider(provider)) redirect("/app/upgrade?error=provider");
  const plan = findPlan(tier, months);
  if (!plan) redirect("/app/upgrade?error=plan");

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

  // Страница чекаута — зона ответственности Agent U; просто уводим туда с pid.
  redirect(`/app/upgrade/checkout?pid=${row!.id}`);
}
