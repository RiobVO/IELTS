"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import { payment, preorder } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { captureServer } from "@/lib/analytics/server";
import { findPlan, PENDING_TTL_MS } from "@/lib/payments/plans";
import { paymentsLive } from "@/lib/payments";
import type { PaymentProviderKey } from "@/env";

const VALID_PROVIDERS: readonly PaymentProviderKey[] = ["payme", "click", "uzum"];

function isProvider(v: string): v is PaymentProviderKey {
  return (VALID_PROVIDERS as readonly string[]).includes(v);
}

/** Откуда пришёл клик по pre-order (§11 source_page) — whitelist серверной
 *  стороны: клиентская строка не должна долетать до PostHog как есть. */
const VALID_SOURCE_PAGES = ["pricing", "upgrade"] as const;
type SourcePage = (typeof VALID_SOURCE_PAGES)[number];

function isSourcePage(v: string): v is SourcePage {
  return (VALID_SOURCE_PAGES as readonly string[]).includes(v);
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
 * Pre-order early-bird плана (§12): пока оплата не запущена, кнопка на pricing
 * фиксирует намерение купить со скидкой — owner-path INSERT в `preorder`, БЕЗ
 * выдачи доступа. Отдельная таблица, а не запись в `payment`: payment завязан на
 * provider/tx-идемпотентность и webhook-lifecycle («payment = реальный charge» —
 * инвариант, см. applyCompletedPayment/validateEntitlement), а pre-order тира не
 * даёт — только намерение. ON CONFLICT DO NOTHING — повторный клик на тот же
 * (user, tier, months) идемпотентен (unique-constraint миграции 0052). Сумма —
 * plan.earlyBirdAmount с сервера, клиент её не диктует. Невалидный (tier, months)
 * — тихий no-op, как раньше у waitlist-заглушки. `sourcePage` — с какой
 * страницы кликнули (§11 source_page на событии `preorder`), whitelist'ится
 * isSourcePage: неизвестное значение не долетает до PostHog как сырая строка.
 */
export async function preorderPlan(input: {
  tier: string;
  months: number;
  sourcePage: string;
}): Promise<{ ok: boolean }> {
  const user = await requireUser();
  // Серверный бизнес-инвариант, не только UI-ветка: после запуска платежей
  // прямой вызов action не должен фиксировать early-bird задним числом.
  if (paymentsLive()) return { ok: false };
  const plan = findPlan(String(input.tier), Number(input.months));
  if (!plan) return { ok: false };
  const sourcePage = isSourcePage(input.sourcePage) ? input.sourcePage : "upgrade";

  try {
    await db
      .insert(preorder)
      .values({
        userId: user.id,
        tier: plan.tier,
        periodMonths: plan.months,
        amount: plan.earlyBirdAmount,
        currency: plan.currency,
      })
      .onConflictDoNothing();
  } catch (e) {
    // Durable-обещание цены: о сбое честно сообщаем клиенту ({ok:false} → кнопка
    // остаётся активной), событие воронки не шлём — строки нет, врать метрике незачем.
    console.error("preorderPlan insert failed", e);
    return { ok: false };
  }

  await captureServer("preorder", user.id, {
    tier: plan.tier,
    period_months: plan.months,
    source_page: sourcePage,
  });
  return { ok: true };
}
