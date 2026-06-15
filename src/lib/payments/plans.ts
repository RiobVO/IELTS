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
    label: "Premium · 1 месяц",
  },
  {
    tier: "premium",
    months: 12,
    amount: 49_000_000, // 490 000 UZS (≈ 2 месяца в подарок)
    currency: "UZS",
    label: "Premium · 12 месяцев",
  },
  {
    tier: "ultra",
    months: 1,
    amount: 9_900_000, // 99 000 UZS
    currency: "UZS",
    label: "Ultra · 1 месяц",
  },
  {
    tier: "ultra",
    months: 12,
    amount: 99_000_000, // 990 000 UZS (≈ 2 месяца в подарок)
    currency: "UZS",
    label: "Ultra · 12 месяцев",
  },
];

/**
 * Найти тариф по паре (tier, months). Возвращает undefined для неизвестной
 * комбинации — вызывающий код обязан проверить, а не доверять клиентскому вводу.
 */
export function findPlan(tier: string, months: number): Plan | undefined {
  return PLANS.find((p) => p.tier === tier && p.months === months);
}
