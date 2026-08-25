/**
 * «План до экзамена N дней» (G2-2) — недельный РИТМ на всю дистанцию до даты, в
 * дополнение к дневному чек-листу (daily-plan.ts) и плану до target band
 * (band-plan.ts). Разделение ролей: Today's plan отвечает «что сделать сегодня»,
 * этот план — «сколько недель осталось и с какой частотой заниматься», иначе
 * каунтдаун так и остаётся голой цифрой дней.
 *
 * ЧИСТОЕ ЯДРО: без IO/БД/часов — всё время-зависимое (дни до экзамена, моки этой
 * недели) редуцировано вызывающей стороной в скаляры, как в computeDailyPlan.
 * Данные на дашборде уже загружены, новых запросов пункт не добавляет.
 *
 * Пороги фаз НЕ дублируются — берутся из intensityFor (daily-plan.ts): «финальная
 * неделя» обязана значить одно и то же в обеих карточках одного экрана.
 */
import { intensityFor } from "./daily-plan";

/** Слабый тип в формате, достаточном для показа фокуса (label уже человеческий). */
export interface ExamPlanWeakType {
  qtype: string;
  label: string;
}

export interface ExamPlanInput {
  /** Дни до экзамена (getExamCountdown); null — дата не задана. */
  daysUntilExam: number | null;
  /** Есть ли хоть одна сданная попытка — без них план начинается с калибровки. */
  hasAttempts: boolean;
  /** Слабейший тип (bandPlan.weakTypes[0]) и следующий за ним; null — нечего фокусировать. */
  weakest: ExamPlanWeakType | null;
  second: ExamPlanWeakType | null;
  /** Полных моков сдано в текущей неделе (та же цифра, что у Today's plan). */
  mocksThisWeek: number;
}

/** Норма частоты на фазе: моков в неделю и дней занятий в неделю. */
export interface ExamPlanRhythm {
  mocks: number;
  /** Дней занятий в неделю — «сколько раз сесть», не сколько тестов за раз:
   *  дневную норму тестов уже несёт DAILY_DRILL_TARGET, дублировать её нельзя. */
  studyDays: number;
}

export type ExamPlanPhase = "base" | "ramp" | "final";

export interface ExamPlan {
  phase: ExamPlanPhase;
  daysUntilExam: number;
  /** Полных недель до даты, вверх: 1 день и 6 дней одинаково «последняя неделя». */
  weeksLeft: number;
  rhythm: ExamPlanRhythm;
  mocksThisWeek: number;
  /** Сколько моков ещё нужно на этой неделе (0 — норма закрыта). */
  mocksLeftThisWeek: number;
  /** Ориентир дистанции: моков всего при этом ритме до даты. */
  mocksTotalLeft: number;
  /** Фокус недели: 1 тип в base/ramp, 2 в final; пусто — пока не на чем фокусироваться. */
  focus: ExamPlanWeakType[];
  /** Ни одной попытки: сначала калибровочный мок, фокуса ещё не существует. */
  needsCalibration: boolean;
  /** Экзамен завтра — в последний день только лёгкое повторение, не новый мок. */
  restDayAhead: boolean;
}

/** Ритм по фазе. Числа консервативны намеренно: невыполнимая норма демотивирует
 *  сильнее, чем отсутствие нормы, а дневную нагрузку всё равно ведёт Today's plan. */
const RHYTHM: Record<ExamPlanPhase, ExamPlanRhythm> = {
  base: { mocks: 1, studyDays: 4 },
  ramp: { mocks: 2, studyDays: 5 },
  // В финальной неделе мок ОДИН: на большее не остаётся времени разобрать ошибки,
  // а неразобранный мок band не двигает.
  final: { mocks: 1, studyDays: 6 },
};

/**
 * Чистая сборка плана. `null` — карточке нечего показывать:
 *  · дата не задана или невалидна → приглашение задать её уже несёт countdown-карточка,
 *    второй призыв на том же экране был бы дублем;
 *  · дата сегодня или в прошлом → ритм «на оставшиеся недели» бессмыслен, а countdown
 *    в этих состояниях говорит «Exam day is today!» / «Set a new date».
 */
export function computeExamPlan(input: ExamPlanInput): ExamPlan | null {
  const { daysUntilExam, hasAttempts, weakest, second, mocksThisWeek } = input;
  if (daysUntilExam == null || !Number.isFinite(daysUntilExam) || daysUntilExam <= 0) return null;

  const intensity = intensityFor(daysUntilExam);
  // generic сюда не доходит: он означает «нет даты / дата прошла», а оба случая
  // отсечены выше. Явная проверка вместо `as` — чтобы смена порогов в daily-plan.ts
  // не протащила сюда невозможную фазу молча.
  if (intensity === "generic") return null;
  const phase: ExamPlanPhase = intensity;

  const rhythm = RHYTHM[phase];
  const weeksLeft = Math.max(1, Math.ceil(daysUntilExam / 7));

  const needsCalibration = !hasAttempts;
  // Фокус существует только поверх реальных данных: без попыток слабого типа нет,
  // выдумывать «поработай над Matching Headings» некорректно.
  const focus: ExamPlanWeakType[] = [];
  if (!needsCalibration && weakest) {
    focus.push(weakest);
    // Второй тип — только в финале: раньше он размывает фокус, а времени ещё много.
    if (phase === "final" && second) focus.push(second);
  }

  return {
    phase,
    daysUntilExam,
    weeksLeft,
    rhythm,
    mocksThisWeek,
    mocksLeftThisWeek: Math.max(0, rhythm.mocks - mocksThisWeek),
    mocksTotalLeft: weeksLeft * rhythm.mocks,
    focus,
    needsCalibration,
    restDayAhead: daysUntilExam <= 1,
  };
}
