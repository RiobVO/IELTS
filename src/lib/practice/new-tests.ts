/**
 * Витрина «новое на этой неделе» (growth-волна 1, G1-2). Чистая выборка: какие
 * опубликованные тесты считаются свежими и в каком порядке их показывать.
 *
 * Свежесть меряется датой ПУБЛИКАЦИИ (`published_at`, migration 0059), а не импорта:
 * файл заливается ботом и лежит черновиком до ревью, поэтому `created_at` регулярно
 * старше выхода теста в каталог на дни.
 *
 * Функция чистая (now передаётся, не берётся из часов) — границы окна тестируются
 * без БД и без подмены таймеров, а страница вызывает её вне unstable_cache-обёртки
 * каталога (кэш переживает TTL, «сейчас» внутри него протухало бы).
 */

/** Окно свежести — 7 дней. Та же величина держит и бейдж «New» на карточке. */
export const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Сколько карточек показывает витрина. Больше — уже не витрина, а второй каталог. */
export const NEW_SHOWCASE_LIMIT = 4;

export interface FreshCandidate {
  /** ISO-строка даты публикации (getPublishedTests сериализует её сам). */
  publishedAt: string;
}

/** Опубликован ли тест в пределах окна свежести относительно `now`. */
export function isFresh(publishedAtIso: string, now: number): boolean {
  const ts = Date.parse(publishedAtIso);
  // Невалидная дата (битая строка) — НЕ свежесть: молча помечать «New» неизвестное
  // хуже, чем не пометить.
  if (!Number.isFinite(ts)) return false;
  return ts > now - NEW_WINDOW_MS && ts <= now;
}

/**
 * Свежие тесты, новейшие первыми, не длиннее `limit`. Пустой результат — сигнал
 * вызывающему НЕ рендерить блок вовсе (пустая коробка в каталоге хуже её отсутствия).
 */
export function selectNewThisWeek<T extends FreshCandidate>(
  tests: readonly T[],
  now: number,
  limit: number = NEW_SHOWCASE_LIMIT,
): T[] {
  return tests
    .filter((t) => isFresh(t.publishedAt, now))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, Math.max(0, limit));
}
