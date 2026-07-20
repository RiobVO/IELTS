import { NextResponse } from "next/server";
import { applyCompletedPayment, verifyWebhook } from "@/lib/payments";
import type { PaymentProviderKey } from "@/env";

/**
 * Платёжный вебхук провайдера (BRIEF §4.8 / §11). Только COMPLETED-платёж
 * продлевает доступ — здесь проверка подписи + идемпотентное применение по ключу
 * (provider, providerTransactionId). Middleware исключает /api/webhooks из
 * auth-сессии: запрос идёт от провайдера, а не от залогиненного юзера.
 *
 * БЕЗОПАСНОСТЬ: из тела берём ТОЛЬКО providerTransactionId (ключ поиска). Сумма,
 * тариф, срок и владелец берутся из серверной PENDING-строки внутри
 * applyCompletedPayment — телу вебхука доверять нельзя (иначе любой POST с
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

  if (!verifyWebhook(provider, request, rawBody)) {
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

  const outcome = await applyCompletedPayment(provider, providerTransactionId);

  // applied/duplicate -> 200 (успешный идемпотентный ack). not_found/invalid ->
  // 400 (запрос некорректен, ретрай не поможет). error -> 500 (временная ошибка —
  // провайдер ретраит, применение само идемпотентно).
  if (outcome === "error") {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (outcome === "not_found" || outcome === "invalid") {
    return NextResponse.json({ ok: false, reason: outcome }, { status: 400 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
