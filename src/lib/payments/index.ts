/**
 * Платёжный seam: проверка вебхука провайдера + применение завершённого платежа
 * (BRIEF §4.8 / §11). SERVER-ONLY — использует Drizzle owner-клиент (`@/db`,
 * обходит RLS): запись payment-строк и продление profile.premium_until/tier —
 * привилегированные операции, которые RLS заблокировала бы.
 *
 * ДОВЕРИЕ: тело вебхука НЕ авторитетно. Единственный доверенный источник суммы,
 * тарифа, срока и владельца — это PENDING-строка, созданная сервером в
 * initiatePayment (цена из findPlan, userId из сессии). Вебхук приносит ключ
 * (provider, providerTransactionId) + подписанные claims (amount/currency/status);
 * по ключу мы находим строку, claims в real-режиме СВЕРЯЮТСЯ с ней
 * (reconcileClaims — «не доверять» ≠ «игнорировать»: игнор суммы = недоплата
 * выдала бы доступ), а сама выдача идёт строго из строки. Иначе любой POST с
 * tier='ultra' выдал бы доступ бесплатно.
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
import { logError } from "@/lib/monitoring/log-error";
import { db } from "@/db";
import { payment, profile } from "@/db/schema";
import { type PaymentProviderKey, paymentSecret } from "@/env";
import {
  isPaymentExpired,
  validateEntitlement,
  stacksOnExistingPeriod,
  paymentFailureReason,
  reconcileClaims,
  type PaymentOutcome,
  type WebhookClaims,
} from "./plans";
import { hmacHexValid } from "./webhook-signature";

/** true в боевом окружении — там stub-режим вебхука запрещён (fail closed). */
function isProduction(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production"
  );
}

/**
 * Доступен ли пользователю реальный платёжный флоу.
 *
 * Зеркалит условие приёма verifyWebhook: показывать чекаут можно ТОЛЬКО когда
 * последующий вебхук его завершит. В production для этого нужен мерчант-ключ
 * провайдера — без него verifyWebhook fail-closed вернёт 400, и юзер упрётся в
 * тупик оплаты (сырой HTTP-400). Вне production sandbox-стаб принимает вебхук без
 * ключа, поэтому флоу остаётся рабочим инструментом разработки.
 *
 * Гейт ПО-ПРОВАЙДЕРНО: сконфигурированный payme-ключ не делает живыми click/uzum
 * (иначе кованая форма с provider=click создала бы pending в тупик). Дефолт
 * "payme" — единственный провайдер, который pricing-CTA реально инициирует.
 */
export function paymentsLive(provider: PaymentProviderKey = "payme"): boolean {
  if (!isProduction()) return true;
  return paymentSecret(provider) !== null;
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
export async function verifyWebhook(
  provider: PaymentProviderKey,
  request: Request,
  rawBody: string,
): Promise<boolean> {
  const secret = paymentSecret(provider);
  if (secret === null) {
    if (isProduction()) {
      await logError({
        source: "server",
        message: `verifyWebhook: REFUSING "${provider}" — no merchant key configured in production (fail closed)`,
        context: { op: "verifyWebhook", provider },
      });
      return false;
    }
    console.warn(
      `verifyWebhook: STUB MODE for "${provider}" — no merchant key, signature check skipped (non-production only). Set the provider key before launch.`,
    );
    return true;
  }

  const sent = request.headers.get("x-payment-signature");
  if (!sent) {
    await logError({
      source: "server",
      message: `verifyWebhook: missing x-payment-signature for "${provider}"`,
      context: { op: "verifyWebhook", provider },
    });
    return false;
  }

  // Generic HMAC-SHA256(rawBody, secret) hex, constant-time. ПЛЕЙСХОЛДЕР — у
  // каждого провайдера своя схема; заменить на провайдер-специфичную при онбординге.
  return hmacHexValid(secret, sent, rawBody);
}

/**
 * Применить завершённый платёж по ключу (provider, providerTransactionId).
 * Идемпотентно, единый-выстрел, best-effort. Доступ выдаётся строго из доверенной
 * PENDING-строки; `claims` — подписанные поля тела (amount/currency/status),
 * которые в real-режиме ОБЯЗАНЫ сойтись с ней (reconcileClaims): «не доверять
 * телу» ≠ «игнорировать тело» — иначе недоплата выдала бы доступ. В stub-режиме
 * (нет мерчант-ключа; в production недостижимо — verifyWebhook fail-closed)
 * сверка пропускается: минимальная стаб-форма этих полей не несёт.
 *
 *   not_found — нет инициированного платежа с таким id (отклоняем, доступ не выдан).
 *   invalid   — (tier, срок, сумма) не соответствуют каталогу findPlan ИЛИ
 *               подтверждённые провайдером amount/currency разошлись с заказом
 *               -> помечаем 'failed'.
 *   expired   — pending протух (expires_at в прошлом) -> помечаем 'failed', доступ не выдан.
 *   duplicate — платёж уже был применён ранее (идемпотентный ack).
 *   ignored   — событие со status ≠ completed: принято (200), без мутации и без
 *               выдачи — charge ещё может завершиться, терминалить рано.
 *   applied   — доступ выдан.
 *   error     — внутренняя ошибка ИЛИ незамапленное обязательное поле claims в
 *               real-режиме (вебхук ответит 500, чтобы провайдер ретраил).
 */
export async function applyCompletedPayment(
  provider: PaymentProviderKey,
  providerTransactionId: string,
  claims: WebhookClaims = {},
): Promise<PaymentOutcome> {
  // Захваченная выдача для пост-коммит телеметрии (§11). Заполняется ТОЛЬКО на
  // успешном applied внутри транзакции, читается после её коммита.
  let granted: { userId: string; tier: string; periodMonths: number } | null =
    null;
  // Владелец платежа для события payment_failed. Выставляется, как только найдена
  // доверенная строка (до любой ветки-неуспеха и до возможного throw), чтобы отвал
  // можно было атрибутировать. Остаётся null, если строки нет (not_found) или сбой
  // случился раньше её чтения — тогда атрибутировать некому, событие не шлём.
  let subjectUserId: string | null = null;
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
          currency: payment.currency,
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
      subjectUserId = row.userId; // владелец найден — можно атрибутировать отвал
      // Любой НЕ-pending статус терминален: completed — платёж уже применён,
      // failed — уже отклонён (expired/invalid, single-fire события отправлены).
      // Идемпотентный ack, иначе ретрай вебхука повторно гнал бы failed-строку
      // через expired/invalid ветки и дублировал payment_failed.
      if (row.status !== "pending") return "duplicate";

      // Сверка подписанных полей провайдера с заказом (волна 0a). ТОЛЬКО в
      // real-режиме: гейт тем же paymentSecret, что и verifyWebhook — stub-режим
      // (нет ключа) принимает минимальную форму без claims, а в production
      // отсутствие ключа уже отвергнуто fail-closed проверкой подписи.
      if (paymentSecret(provider) !== null) {
        const verdict = reconcileClaims(
          { amount: row.amount, currency: row.currency },
          claims,
        );
        if (!verdict.ok) {
          if (verdict.reason === "missing_field") {
            // Адаптер провайдера (0b) не замапил обязательное поле — fail closed
            // БЕЗ мутации: 500 → провайдер ретраит, баг адаптера громкий (логом),
            // а не молчаливой выдачей доступа. logError идёт отдельным коннектом
            // (не в этой tx) — мутаций тут нет, коммитить/откатывать нечего.
            await logError({
              source: "server",
              message: `applyCompletedPayment: missing signed claim field for "${provider}" — adapter must map amount/currency/status (fail closed)`,
              context: { op: "applyCompletedPayment", provider, providerTransactionId },
            });
            return "error";
          }
          // Не-completed событие (pending/failed/cancelled у провайдера): charge
          // ещё может завершиться — НЕ терминалим строку, просто не выдаём.
          if (verdict.reason === "not_completed") return "ignored";
          // amount/currency разошлись с заказом: недоплата/переплата/чужая валюта
          // — терминальный отказ (single-fire, как invalid-ветка ниже).
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
      }

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
      //
      // FOR UPDATE обязателен (0a-db, прод-баг #5): без лока два конкурентных платежа
      // одного юзера читают СТАРЫЙ tier, оба выбирают «reset от now()», и второй грант
      // затирает первый — оплаченный период теряется. Лок сериализует stack-решение;
      // порядок локов profile→payment зеркалит profile→content_item из startAttempt /
      // apply-post-submit (единый инвариант против deadlock'ов).
      const [prof] = await tx
        .select({ tier: profile.tier })
        .from(profile)
        .where(eq(profile.id, row.userId))
        .limit(1)
        .for("update");
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
      const grantedRows = await tx
        .update(profile)
        .set({
          tier: row.tier,
          premiumUntil: premiumUntilExpr,
        })
        .where(eq(profile.id, row.userId))
        .returning({ id: profile.id });
      // Drizzle НЕ бросает на нулевом апдейте: без этой проверки платёж остался бы
      // completed без выданного доступа — молча. Сегодня недостижимо (FK
      // payment.user_id→profile + row-lock claimed-строки), но любая будущая правка
      // WHERE-клаузы сделала бы дыру невидимой. Throw откатывает ВСЮ транзакцию
      // (claim в т.ч. — payment остаётся pending) → outcome "error" → провайдер
      // ретраит: состояние восстановимо, не потерянный платёж.
      if (grantedRows.length === 0) {
        throw new Error(
          `applyCompletedPayment: profile ${row.userId} vanished during grant (${provider}/${providerTransactionId})`,
        );
      }

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

    // payment_failed — событие воронки на неуспешных исходах (§11). ПОСЛЕ коммита
    // (best-effort, как upgrade) и только когда известен владелец. Атомарную логику
    // не трогает — читает исход уже завершённой транзакции.
    const reason = paymentFailureReason(outcome);
    if (reason && subjectUserId) {
      await captureServer("payment_failed", subjectUserId, { provider, reason });
    }

    return outcome;
  } catch (e) {
    // Денежный путь: ошибка глотается в "error" (провайдер ретраит), но молча
    // терять её из мониторинга нельзя — logError (error_log) + captureError
    // (Sentry, пока no-op) с ключом платежа (§11).
    await logError({
      source: "server",
      message: "applyCompletedPayment failed",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "applyCompletedPayment", provider, providerTransactionId },
    });
    captureError(e, { provider, providerTransactionId });
    // Тот же отвал — в продуктовую воронку, если владелец успел определиться до сбоя.
    if (subjectUserId) {
      await captureServer("payment_failed", subjectUserId, {
        provider,
        reason: "error",
      });
    }
    return "error";
  }
}
