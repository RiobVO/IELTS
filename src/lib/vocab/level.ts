/**
 * Уровневый каталог Vocabulary (0039): CEFR-канон уровней + маппинг целевого
 * IELTS-band пользователя в рекомендованный уровень дека. Чистый модуль (без БД /
 * server-only) — покрывается юнит-тестами напрямую и переиспользуется парсером
 * (валидация level_band) и страницей каталога (секции грида + бейдж «Recommended»).
 */

/** Канон CEFR-уровней уровневого каталога: ровно три ступени. */
export type CefrLevel = "B1" | "B2" | "C1";

/** Порядок секций каталога снизу вверх (Foundation → Independent → Advanced). */
export const LEVEL_ORDER: readonly CefrLevel[] = ["B1", "B2", "C1"];

/**
 * Целевой IELTS-band → рекомендованный CEFR-уровень дека. Границы включительно
 * вверх: <5.5 → B1; [5.5, 7) → B2; ≥7 → C1. null (band не задан) → null.
 * Служит только для бейджа «Recommended» — доступ к декам не гейтит (это тир).
 */
export function bandToCefr(targetBand: number | null): CefrLevel | null {
  if (targetBand == null) return null;
  if (targetBand < 5.5) return "B1";
  if (targetBand < 7) return "B2";
  return "C1";
}
