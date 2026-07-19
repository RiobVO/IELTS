import { NextResponse } from "next/server";
import { applyCompletedPayment, verifyWebhook } from "@/lib/payments";
import type { WebhookClaims } from "@/lib/payments/plans";
import type { PaymentProviderKey } from "@/env";

/**
 * Платёжный вебхук провайдера (BRIEF §4.8 / §11). Только COMPLETED-платёж
 * продлевает доступ — здесь проверка подписи + идемпотентное применение по ключу
 * (provider, providerTransactionId). Middleware исключает /api/webhooks из
 * auth-сессии: запрос идёт от провайдера, а не от залогиненного юзера.
 *
 * БЕЗОПАСНОСТЬ: из тела берём providerTransactionId (ключ поиска) и подписанные
 * claims (amount/currency/status — parseClaims) ДЛЯ СВЕРКИ с pending-строкой.
 * Источник выдачи — только серверная PENDING-строка внутри applyCompletedPayment;
 * tier/userId/periodMonths из тела не читаются никогда (иначе любой POST с
 * tier='ultra' выдал бы доступ бесплатно).
 *
 * Идемпотентность гарантирует applyCompletedPayment (UNIQUE на provider+tx):
 * повтор -> "duplicate" -> 200 (детерминированный ack, чтобы провайдер не ретраил).
 */
export const dynamic = "force-dynamic";

const VALID_PROVIDERS: readonly PaymentProviderKey[] = ["payme", "click", "uzum"];

function isProvider(v: string): v is PaymentProviderKey {
  return (VALID_PROVIDERS as readonly string[]).includes(v);
}

/**
 * Достаём идемпотентный ключ из тела. Реальные Payme/Click/Uzum шлют свои
 * JSON-RPC структуры — адаптер «их форма -> наш providerTransactionId» добавится
 * при онбординге мерчанта. До этого принимаем минимальную стаб-форму.
 */
function parseTransactionId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const id = (raw as Record<string, unknown>).providerTransactionId;
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Подписанные поля тела для сверки с pending-строкой (reconcileClaims):
 * amount (минорные единицы, integer) / currency / status. Провайдер-агностично;
 * tier/userId/periodMonths из тела НЕ читаются НИКОГДА — источник выдачи только
 * серверная pending-строка. Поле неверного типа отбрасывается (undefined) — в
 * real-режиме это missing_field → fail closed, мусор не проходит молча.
 */
function parseClaims(raw: unknown): WebhookClaims {
  if (typeof raw !== "object" || raw === null) return {};
  const o = raw as Record<string, unknown>;
  const claims: WebhookClaims = {};
  if (typeof o.amount === "number" && Number.isInteger(o.amount)) {
    claims.amount = o.amount;
  }
  if (typeof o.currency === "string" && o.currency !== "") {
    claims.currency = o.currency;
  }
  if (typeof o.status === "string" && o.status !== "") {
    claims.status = o.status;
  }
  return claims;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider } = await ctx.params;
  if (!isProvider(provider)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Сырое тело нужно ДО парсинга — подпись считается от байтов, не от
  // ре-сериализованного JSON (он мог бы отличаться порядком ключей/пробелами).
  const rawBody = await request.text();

  if (!(await verifyWebhook(provider, request, rawBody))) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const providerTransactionId = parseTransactionId(json);
  if (!providerTransactionId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const outcome = await applyCompletedPayment(
    provider,
    providerTransactionId,
    parseClaims(json),
  );

  // applied/duplicate/ignored -> 200 (успешный идемпотентный ack; ignored =
  // не-completed событие принято без выдачи). not_found/invalid/expired -> 400
  // (запрос неприменим, ретрай не поможет). error -> 500 (временная ошибка —
  // провайдер ретраит, применение само идемпотентно).
  if (outcome === "error") {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (outcome === "not_found" || outcome === "invalid" || outcome === "expired") {
    return NextResponse.json({ ok: false, reason: outcome }, { status: 400 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
