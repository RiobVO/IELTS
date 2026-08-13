/**
 * Покупаемые тарифы (BRIEF §4.8). Цены — плейсхолдеры в тийинах (1 UZS = 100
 * тийин), уточняются на старте продаж. Держим прайс в одном месте: и страница
 * апгрейда, и initiate-action берут сумму отсюда, чтобы клиент не диктовал цену.
 *
 * `amount` — в МИНОРНЫХ единицах (тийин), как и колонка payment.amount: провайдеры
 * UZ (Payme/Click/Uzum) принимают суммы в тийинах, целым числом без округлений.
 */
export interface Plan {
  tier: "premium" | "ultra";
  months: number;
  amount: number; // тийин (минорные единицы UZS)
  currency: "UZS";
  label: string;
}

/**
 * Каталог тарифов: Premium и Ultra, помесячно и годовой (12 мес. со скидкой).
 * Годовая сумма ниже 12× месячной — это и есть стимул к годовой подписке.
 */
export const PLANS: Plan[] = [
  {
    tier: "premium",
    months: 1,
    amount: 4_900_000, // 49 000 UZS
    currency: "UZS",
    label: "Premium · 1 month",
  },
  {
    tier: "premium",
    months: 12,
    amount: 49_000_000, // 490 000 UZS (≈ 2 месяца в подарок)
    currency: "UZS",
    label: "Premium · 12 months",
  },
  {
    tier: "ultra",
    months: 1,
    amount: 9_900_000, // 99 000 UZS
    currency: "UZS",
    label: "Ultra · 1 month",
  },
  {
    tier: "ultra",
    months: 12,
    amount: 99_000_000, // 990 000 UZS (≈ 2 месяца в подарок)
    currency: "UZS",
    label: "Ultra · 12 months",
  },
];

/**
 * Найти тариф по паре (tier, months). Возвращает undefined для неизвестной
 * комбинации — вызывающий код обязан проверить, а не доверять клиентскому вводу.
 */
export function findPlan(tier: string, months: number): Plan | undefined {
  return PLANS.find((p) => p.tier === tier && p.months === months);
}

/**
 * Анти-фрод инвариант вебхука: выданный доступ допустим, только если (tier, срок)
 * — продаваемый план из каталога, а сумма точно совпадает с его ценой. Чистая
 * функция от полей доверенной payment-строки (НЕ от тела вебхука), вынесена из
 * applyCompletedPayment, чтобы покрыть тестами в изоляции. Любое расхождение
 * суммы (частичная оплата, подделка) или непроданная пара -> false: доступ не
 * выдаётся (см. src/lib/payments/index.ts).
 */
export function validateEntitlement(row: {
  tier: string;
  periodMonths: number;
  amount: number;
}): boolean {
  const plan = findPlan(row.tier, row.periodMonths);
  return plan !== undefined && plan.amount === row.amount;
}

/**
 * Продление при оплате: складывать новый срок ПОВЕРХ остатка допустимо только когда
 * тариф не меняется. При смене тарифа интервал обязан стартовать от now(), иначе
 * остаток чужого тарифа даёт либо дешёвый апгрейд (Ultra поверх годового Premium =
 * Ultra на ~13 мес за 1), либо потерю оплаченного (Premium поверх Ultra перезаписывает
 * тариф и срок). Чистое решение (#8); сам интервал считает SQL now()/greatest/interval
 * в applyCompletedPayment. NULL/basic currentTier никогда не совпадает с покупаемым.
 */
export function stacksOnExistingPeriod(
  currentTier: string | null,
  purchasedTier: string,
): boolean {
  return currentTier === purchasedTier;
}

/**
 * Все возможные исходы applyCompletedPayment. Именованный union — единый источник
 * правды и для webhook-роута (маппинг в HTTP-код), и для нормализации в событие
 * воронки (paymentFailureReason).
 */
export type PaymentOutcome =
  | "applied"
  | "duplicate"
  | "not_found"
  | "invalid"
  | "expired"
  | "error";

/** Причина неуспеха для события `payment_failed`. */
export type PaymentFailureReason = "invalid" | "expired" | "error";

/**
 * Нормализация исхода применения платежа в причину неуспеха для воронки (§11).
 * Чистая функция — тестируется без БД. Событие НЕ порождают:
 *   applied   — успех (его меряет `upgrade`);
 *   duplicate — идемпотентный ретрай провайдера, не отдельный отвал;
 *   not_found — нет доверенной строки → некого атрибутировать (нет userId).
 * Остальные (invalid/expired/error) — реальные потери на денежном пути.
 */
export function paymentFailureReason(
  outcome: PaymentOutcome,
): PaymentFailureReason | null {
  switch (outcome) {
    case "invalid":
      return "invalid";
    case "expired":
      return "expired";
    case "error":
      return "error";
    default:
      return null;
  }
}

/**
 * Срок жизни PENDING-чекаута. После него незавершённый платёж нельзя применить:
 * webhook переводит устаревший pending в `failed` и доступ НЕ выдаёт (см.
 * applyCompletedPayment). Это закрывает бессрочно-применимые abandoned-строки
 * (reconciliation/fraud/поддержка). ПЛЕЙСХОЛДЕР до онбординга мерчанта — окно
 * подогнать под реальные правила Payme/Click/Uzum (обычно 15 мин – 24 ч).
 */
export const PENDING_TTL_MS = 60 * 60 * 1000; // 1 час

/**
 * Истёк ли PENDING-платёж к моменту `now`. Чистая функция (решение webhook
 * тестируется без БД). NULL `expires_at` (legacy-строки до миграции 0020) и
 * нечитаемую дату трактуем как «не истёк» — не отклоняем по отсутствию/мусору
 * данных, только по доказанно прошедшему сроку. Граница `==` ещё жив (строго <).
 */
export function isPaymentExpired(
  expiresAt: Date | string | null,
  now: Date,
): boolean {
  if (expiresAt == null) return false;
  const t =
    expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isFinite(t) && t < now.getTime();
}
