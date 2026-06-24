import type { ActivePage } from "./AppHeader";

/**
 * Practice — единый верхний nav-пункт, объединяющий хаб и оба каталога. Хедер и
 * loading-скелетон должны подсвечивать его одинаково на трёх маршрутах
 * (`/app/practice`, `/app/reading`, `/app/listening`), поэтому правило живёт в
 * одном месте. Plain-модуль (без `"use client"`): импортируется и клиентским
 * `AppHeader`, и серверным `Skeletons` — type-only импорт `ActivePage` стирается
 * компилятором, runtime-цикла нет.
 */
const PRACTICE_PAGES: ReadonlySet<ActivePage> = new Set(["practice", "reading", "listening"]);

/** id nav-пункта, который подсвечивается для активной страницы. */
export function navHighlight(active: ActivePage): ActivePage {
  return PRACTICE_PAGES.has(active) ? "practice" : active;
}
