/**
 * Категории полного теста (full mock). Единый список: predicate ниже и SQL-фильтры
 * (band-запрос дашборда, каталог) ссылаются сюда, чтобы список не расходился по
 * кодовой базе. До 0063 жил в trial.ts; trial-лейн удалён, а предикат «полный
 * тест» — общего назначения (band-логика, фолбэк длительности runner route).
 */
export const FULL_CATEGORIES = ["full_reading", "full_listening"] as const;

/** Полный тест — категория из FULL_CATEGORIES. */
export function isFullCategory(category: string): boolean {
  return (FULL_CATEGORIES as readonly string[]).includes(category);
}
