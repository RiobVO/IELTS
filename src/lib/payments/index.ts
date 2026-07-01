/**
 * Платёжный seam: проверка вебхука провайдера + применение завершённого платежа
 * (BRIEF §4.8 / §11). SERVER-ONLY — использует Drizzle owner-клиент (`@/db`,
 * обходит RLS): запись payment-строк и продление profile.premium_until/tier —
 * привилегированные операции, которые RLS заблокировала бы.
 *
 * ДОВЕРИЕ: тело вебхука НЕ авторитетно. Единственный доверенный источник суммы,
 * тарифа, срока и владельца — это PENDING-строка, созданная сервером в
 * initiatePayment (цена из findPlan, userId из сессии). Вебхук приносит ТОЛЬКО
 * ключ (provider, providerTransactionId); по нему мы находим строку и выдаём
 * доступ строго из неё. Иначе любой POST с tier='ultra' выдал бы доступ бесплатно.
 *
 * Идемпотентность завязана на UNIQUE(provider, provider_transaction_id): повтор
 * вебхука (провайдеры шлют ретраи) НИКОГДА не применяет платёж дважды. Захват +
 * продление + установка тарифа идут в ОДНОЙ db.transaction (зеркалит
 * src/lib/progress/referral.ts), иначе краш между захватом и продлением оставил
 * бы статус 'completed' без выданного доступа.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { captureServer } from "@/lib/analytics/server";
import { captureError } from "@/lib/monitoring/capture";
import { db } from "@/db";
import { payment, profile } from "@/db/schema";
import { type PaymentProviderKey, paymentSecret } from "@/env";
import { isPaymentExpired, validateEntitlement, stacksOnExistingPeriod } from "./plans";
import { hmacHexValid } from "./webhook-signature";

/** true в боевом окружении — там stub-режим вебхука запрещён (fail closed). */
function isProduction(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production"
  );
}

/**
 * Проверка подписи вебхука.
 *
 * STUB-режим (ключ провайдера отсутствует, paymentSecret === null): допускается
 * ТОЛЬКО вне production — логируем предупреждение и возвращаем true, чтобы
 * lifecycle можно было тестировать без мерчант-ключей (§10). В production
 * отсутствие ключа -> отказ (fail closed): задеплоенный стаб не должен принимать
 * вебхуки без подписи.
 *
 * Боевой режим (ключ есть): сверяем HMAC-SHA256 от сырого тела с заголовком
 * `x-payment-signature` (hex). ЭТО ПЛЕЙСХОЛДЕР — у каждого провайдера своя схема
 * (Payme: Basic-auth, Click: md5-конкатенация, Uzum: свой HMAC). Заменить на
 * провайдер-специфичную проверку при онбординге. Сравнение — timingSafeEqual.
 */
export function verifyWebhook(
  provider: PaymentProviderKey,
  request: Request,
  rawBody: string,
): boolean {
  const secret = paymentSecret(provider);
  if (secret === null) {
    if (isProduction()) {
      console.error(
        `verifyWebhook: REFUSING "${provider}" — no merchant key configured in production (fail closed).`,
      );
      return false;
    }
    console.warn(
      `verifyWebhook: STUB MODE for "${provider}" — no merchant key, signature check skipped (non-production only). Set the provider key before launch.`,
    );
    return true;
  }

  const sent = request.headers.get("x-payment-signature");
  if (!sent) {
    console.error(`verifyWebhook: missing x-payment-signature for "${provider}"`);
    return false;
  }

  // Generic HMAC-SHA256(rawBody, secret) hex, constant-time. ПЛЕЙСХОЛДЕР — у
  // каждого провайдера своя схема; заменить на провайдер-специфичную при онбординге.
  return hmacHexValid(secret, sent, rawBody);
}

/**
 * Применить завершённый платёж по ключу (provider, providerTransactionId).
 * Идемпотентно, единый-выстрел, best-effort. Тело вебхука сюда НЕ передаётся —
 * все значения берутся из доверенной PENDING-строки.
 *
 *   not_found — нет инициированного платежа с таким id (отклоняем, доступ не выдан).
 *   invalid   — (tier, срок, сумма) не соответствуют каталогу findPlan -> помечаем 'failed'.
 *   expired   — pending протух (expires_at в прошлом) -> помечаем 'failed', доступ не выдан.
 *   duplicate — платёж уже был применён ранее (идемпотентный ack).
 *   applied   — доступ выдан.
 *   error     — внутренняя ошибка (вебхук ответит так, чтобы провайдер ретраил).
 */
export async function applyCompletedPayment(
  provider: PaymentProviderKey,
  providerTransactionId: string,
): Promise<
  "applied" | "duplicate" | "not_found" | "invalid" | "expired" | "error"
> {
  // Захваченная выдача для пост-коммит телеметрии (§11). Заполняется ТОЛЬКО на
  // успешном applied внутри транзакции, читается после её коммита.
  let granted: { userId: string; tier: string; periodMonths: number } | null =
    null;
  try {
    const outcome = await db.transaction(async (tx) => {
      // 1. Доверенная строка: создана initiatePayment (userId из сессии, цена из
      //    findPlan). Тело вебхука не участвует — только ключ поиска.
      const [row] = await tx
        .select({
          userId: payment.userId,
          tier: payment.tier,
          periodMonths: payment.periodMonths,
          amount: payment.amount,
          status: payment.status,
          expiresAt: payment.expiresAt,
        })
        .from(payment)
        .where(
          and(
            eq(payment.provider, provider),
            eq(payment.providerTransactionId, providerTransactionId),
          ),
        )
        .limit(1);

      if (!row) return "not_found";
      if (row.status === "completed") return "duplicate";

      // Срок жизни pending: устаревший abandoned-чекаут больше не выдаёт доступ.
      // Проверка ПОСЛЕ duplicate — уже applied-платёж остаётся идемпотентным даже
      // после expires_at. Переводим в 'failed' (single-fire, как invalid ниже).
      if (isPaymentExpired(row.expiresAt, new Date())) {
        await tx
          .update(payment)
          .set({ status: "failed", updatedAt: sql`now()` })
          .where(
            and(
              eq(payment.provider, provider),
              eq(payment.providerTransactionId, providerTransactionId),
              ne(payment.status, "completed"),
            ),
          );
        return "expired";
      }

      // 2. Сверка с каталогом: (tier, срок) должны быть продаваемым планом, а
      //    сумма — совпадать с его ценой. Инвариант независим от доверия к
      //    провайдеру: даже подписанное, но несогласованное сообщение (частичная
      //    оплата, непроданный срок) не выдаст доступ.
      if (!validateEntitlement(row)) {
        await tx
          .update(payment)
          .set({ status: "failed", updatedAt: sql`now()` })
          .where(
            and(
              eq(payment.provider, provider),
              eq(payment.providerTransactionId, providerTransactionId),
              ne(payment.status, "completed"),
            ),
          );
        return "invalid";
      }

      // Продление зависит от смены тарифа: складывать поверх остатка можно только на
      // ТОМ ЖЕ тарифе; при смене — старт от now() (иначе дешёвый апгрейд Ultra-поверх-
      // Premium или потеря оплаченного Ultra при Premium-поверх — #8). Читаем текущий
      // тариф профиля один раз и решаем базу интервала для обеих записей.
      const [prof] = await tx
        .select({ tier: profile.tier })
        .from(profile)
        .where(eq(profile.id, row.userId))
        .limit(1);
      const stack = stacksOnExistingPeriod(prof?.tier ?? null, row.tier);
      const appliedUntilExpr = stack
        ? sql`greatest(now(), (select ${profile.premiumUntil} from ${profile} where ${profile.id} = ${row.userId})) + (${row.periodMonths} || ' months')::interval`
        : sql`now() + (${row.periodMonths} || ' months')::interval`;
      const premiumUntilExpr = stack
        ? sql`greatest(now(), ${profile.premiumUntil}) + (${row.periodMonths} || ' months')::interval`
        : sql`now() + (${row.periodMonths} || ' months')::interval`;

      // 3. Атомарный единый-выстрел: только первый перевод pending->completed
      //    выигрывает (WHERE status<>'completed' + RETURNING сериализует
      //    конкурентные ретраи на блокировке строки), остальные -> duplicate.
      const claimed = await tx
        .update(payment)
        .set({
          status: "completed",
          appliedUntil: appliedUntilExpr,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(payment.provider, provider),
            eq(payment.providerTransactionId, providerTransactionId),
            ne(payment.status, "completed"),
          ),
        )
        .returning({ id: payment.id });

      if (claimed.length === 0) return "duplicate";

      // 4. Выдаём доступ строго из доверенной строки: tier и срок из неё. На том же
      //    тарифе premiumUntilExpr наращивает поверх будущего (stacking), при смене —
      //    стартует от now() (см. stacksOnExistingPeriod / #8).
      await tx
        .update(profile)
        .set({
          tier: row.tier,
          premiumUntil: premiumUntilExpr,
        })
        .where(eq(profile.id, row.userId));

      granted = {
        userId: row.userId,
        tier: row.tier,
        periodMonths: row.periodMonths,
      };
      return "applied";
    });

    // upgrade — событие воронки (§11). Только на реально выданном доступе
    // ("applied", не "duplicate"/"invalid") и ПОСЛЕ коммита транзакции:
    // телеметрия best-effort и не должна удерживать/ломать платёжную транзакцию.
    if (outcome === "applied" && granted) {
      const g: { userId: string; tier: string; periodMonths: number } = granted;
      await captureServer("upgrade", g.userId, {
        provider,
        tier: g.tier,
        period_months: g.periodMonths,
      });
    }

    return outcome;
  } catch (e) {
    // Денежный путь: ошибка глотается в "error" (провайдер ретраит), но молча
    // терять её из мониторинга нельзя — шлём в Sentry с ключом платежа (§11).
    console.error("applyCompletedPayment failed", e);
    captureError(e, { provider, providerTransactionId });
    return "error";
  }
}
