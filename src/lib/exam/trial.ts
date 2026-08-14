/**
 * Trial-лейн (§4.8) — ЧИСТАЯ логика решения, БЕЗ I/O и без `server-only`/`@/db`,
 * чтобы её можно было юнит-тестить как `tiers.ts` (npm test = чистая логика).
 * DB-часть («израсходован ли trial») живёт в `access.ts` (`hasConsumedTrial`).
 */
import { meetsTier, type Tier } from "@/lib/tiers";

/**
 * Категории полного теста (§4.8) — единственные, к которым применим trial-лейн.
 * Единый список: и predicate ниже, и SQL-фильтры (hasConsumedTrial, каталог)
 * ссылаются сюда, чтобы список не расходился по кодовой базе.
 */
export const FULL_CATEGORIES = ["full_reading", "full_listening"] as const;

/** Полный tier-гейтнутый тест — категория из FULL_CATEGORIES. */
export function isFullCategory(category: string): boolean {
  return (FULL_CATEGORIES as readonly string[]).includes(category);
}

/** Попытка юзера на полном gated-тесте — вход для правила расхода trial. */
export interface TrialAttemptRow {
  contentItemId: string;
  status: "in_progress" | "submitted";
}

/**
 * Израсходован ли trial относительно ТЕКУЩЕГО item, по попыткам юзера на полных
 * gated-тестах. Расход = попытка на ДРУГОМ таком тесте ЛИБО СДАННАЯ (submitted) на
 * текущем; исключается только СОБСТВЕННАЯ in_progress текущего item (резюм/submit
 * своего trial). Чистое зеркало WHERE в `hasConsumedTrial` (access.ts) — единый
 * источник правила для гейта (SQL) и каталога (JS).
 */
export function trialConsumedBy(
  attempts: readonly TrialAttemptRow[],
  currentContentItemId: string,
): boolean {
  return attempts.some(
    (a) => a.contentItemId !== currentContentItemId || a.status === "submitted",
  );
}

/**
 * Basic получает доступ к ОДНОМУ полному tier-гейтнутому тесту без апгрейда —
 * обещание лендинга «first full test is free». Единственный источник истины для
 * решения (и старт, и submit зовут его через enforceAccess / runner route).
 *
 * @param trialConsumed есть ли у юзера attempt на ДРУГОМ полном gated-тесте (кроме
 *   текущего content_item) — см. `hasConsumedTrial` в access.ts.
 */
export function trialAllows(args: {
  userTier: Tier;
  tierRequired: Tier;
  category: string;
  trialConsumed: boolean;
}): boolean {
  const { userTier, tierRequired, category, trialConsumed } = args;
  // Обычный tier-гейт пропускает — trial не нужен (premium/ultra; basic-тест).
  if (meetsTier(userTier, tierRequired)) return true;
  // Trial — только Basic и только полный тест. Premium/Ultra и одиночные passage/
  // part не затронуты: им обычный deny.
  if (userTier !== "basic" || !isFullCategory(category)) return false;
  // Единственный бесплатный: доступ, пока trial не израсходован на другом тесте.
  return !trialConsumed;
}
