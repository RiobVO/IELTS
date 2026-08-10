/**
 * Ядро интервального повторения (SM-2, упрощённый детерминированный вариант) для
 * vocab-флеш-карточек. ЧИСТАЯ логика — без IO, времени «изнутри» (now передаётся),
 * env и db; целиком юнит-тестируема (srs.test.ts).
 *
 * MVP-механика — two-button «не знаю / знаю» (Grade = "again" | "good"), поэтому
 * это не полный SuperMemo-2 (0..5), а его редукция до двух исходов. Формула ниже.
 *
 * Формула (порядок как в классическом SM-2 — интервал считается по СТАРОМУ ease,
 * затем ease обновляется):
 *   good:
 *     repetitions += 1
 *     interval = repetitions === 1 ? 1 день
 *              : repetitions === 2 ? 3 дня
 *              : round(prev.interval × prev.ease)   // по ease ДО прибавки
 *     ease = min(2.8, prev.ease + 0.05)
 *   again (провал):
 *     lapses += 1
 *     repetitions = 0            // серия сбрасывается
 *     interval = 0               // карта возвращается в текущую сессию (due = now)
 *     ease = max(1.3, prev.ease − 0.2)
 *   dueAt = now + interval (для interval = 0 → ровно now).
 */

export type Grade = "again" | "good";

export interface SrsState {
  /** Фактор лёгкости SM-2 (float). Стартовый 2.5, коридор [EASE_MIN, EASE_MAX]. */
  ease: number;
  /** Текущий интервал повтора в днях (0 = повтор в этой же сессии). */
  intervalDays: number;
  /** Длина непрерывной серии «good» (сбрасывается в 0 на «again»). */
  repetitions: number;
  /** Счётчик провалов «again» за всю историю карты. */
  lapses: number;
}

// Именованные константы SM-2 — без magic numbers.
const EASE_START = 2.5; // стартовый ease для новой карты
const EASE_MIN = 1.3; // пол ease (классический SM-2)
const EASE_MAX = 2.8; // потолок ease (защита от разбегания интервалов)
const EASE_STEP_GOOD = 0.05; // прибавка ease за «good»
const EASE_STEP_AGAIN = 0.2; // штраф ease за «again»
const INTERVAL_FIRST_DAYS = 1; // repetitions === 1
const INTERVAL_SECOND_DAYS = 3; // repetitions === 2
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Стартовый стейт первого просмотра (когда строки прогресса ещё нет). */
const INITIAL_STATE: SrsState = {
  ease: EASE_START,
  intervalDays: 0,
  repetitions: 0,
  lapses: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Пересчёт SM-2-стейта карты по одной оценке. Детерминирован: одинаковые (state,
 * grade, now) всегда дают идентичный результат (dueAt считается от переданного now).
 *
 * @param state текущий стейт карты или null (первый просмотр → стартовые значения)
 * @param grade исход повтора: "again" (не знаю) / "good" (знаю)
 * @param now   «сейчас» — точка отсчёта dueAt (передаётся снаружи ради детерминизма)
 */
export function reviewCard(
  state: SrsState | null,
  grade: Grade,
  now: Date,
): { state: SrsState; dueAt: Date } {
  const prev = state ?? INITIAL_STATE;

  if (grade === "again") {
    // Провал: серия сброшена, карта возвращается сразу (interval 0 → due = now),
    // ease снижается к полу.
    const next: SrsState = {
      ease: clamp(prev.ease - EASE_STEP_AGAIN, EASE_MIN, EASE_MAX),
      intervalDays: 0,
      repetitions: 0,
      lapses: prev.lapses + 1,
    };
    return { state: next, dueAt: new Date(now.getTime()) };
  }

  // grade === "good"
  const repetitions = prev.repetitions + 1;
  let intervalDays: number;
  if (repetitions === 1) intervalDays = INTERVAL_FIRST_DAYS;
  else if (repetitions === 2) intervalDays = INTERVAL_SECOND_DAYS;
  // По СТАРОМУ ease (до прибавки ниже) — классический порядок SM-2.
  else intervalDays = Math.round(prev.intervalDays * prev.ease);

  const next: SrsState = {
    ease: clamp(prev.ease + EASE_STEP_GOOD, EASE_MIN, EASE_MAX),
    intervalDays,
    repetitions,
    lapses: prev.lapses,
  };
  return { state: next, dueAt: new Date(now.getTime() + intervalDays * MS_PER_DAY) };
}
