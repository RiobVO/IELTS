/**
 * Чистое вычислительное ядро вкладки Overview раздела /app/progress (герой
 * «Траектория» + секция «Прогноз»). Ни IO, ни env, ни БД — только уже загруженные
 * строки на входе, как у computeBandPlan (src/lib/progress/band-plan.ts). UI-агент
 * потребляет ЭТОТ контракт; owner-путь чтения (Drizzle) собирает вход на стороне
 * страницы.
 *
 * Три независимые чистые функции:
 *   buildTrajectory — история band mock-попыток → серии для линии (combined + split);
 *   computeForecast — банд-точки с датами → проекция на день экзамена + коридор + вердикт;
 *   buildReadiness  — последние band по 4 скиллам (R/L из траектории, W/S от UI) → бары.
 *
 * ЧЕСТНОСТЬ ДАННЫХ — сквозной принцип: band есть ТОЛЬКО у Full-40Q mock-попыток
 * (одиночный passage/part band не даёт), а R и L — это РАЗНЫЕ полные тесты, поэтому
 * «настоящего» единого overall-band из одной попытки не существует. Решения по
 * математике задокументированы у каждой функции; при нехватке данных возвращается
 * явный статус, а не выдуманное число.
 */

/* -------------------------------------------------------------------------- */
/* Общие константы + помощники band-арифметики                                 */
/* -------------------------------------------------------------------------- */

const BAND_MIN = 4.0; // нижний кламп прогноза (по ТЗ; историю НЕ клампим — она правдива)
const BAND_MAX = 9.0;
const DAY_MS = 86_400_000;

/** Округление к 0.5-шагу IELTS (6.25→6.5, 6.75→7.0 — как официальное округление overall). */
function roundHalf(x: number): number {
  return Math.round(x * 2) / 2;
}

/** Округление к 0.5-сетке ВНИЗ / ВВЕРХ — для дожатия точки прогноза ВНУТРЬ окна капа. */
function floorHalf(x: number): number {
  return Math.floor(x * 2) / 2;
}
function ceilHalf(x: number): number {
  return Math.ceil(x * 2) / 2;
}

/** Кламп в [4.0, 9.0] + округление к 0.5 — ТОЛЬКО для выходов прогноза (ТЗ). */
function clampRoundBand(x: number): number {
  return roundHalf(Math.min(BAND_MAX, Math.max(BAND_MIN, x)));
}

/** submittedAt (Date | ISO-строка | null) → epoch ms; невалидное/пустое → null. */
function toMs(v: Date | string | null): number | null {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/** epoch ms → 'YYYY-MM-DD' по UTC (стабильно для маркера/горизонта, без tz-дрейфа). */
function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* buildTrajectory — история band для линии графика                            */
/* -------------------------------------------------------------------------- */

export interface TrajectoryAttempt {
  /** band mock-попытки; null у не-Full тестов — такие точки отбрасываются. */
  bandScore: number | null;
  section: "reading" | "listening";
  /** маппится вызывающей стороной из content_item.category (как в band-plan). */
  submittedAt: Date | string | null;
}

export interface TrajectoryPoint {
  /** момент сабмита (epoch ms) — сортируемый ключ; форматирует UI. */
  t: number;
  band: number;
  section: "reading" | "listening";
}

export interface Trajectory {
  /**
   * ВСЕ banded-попытки одной хронологической серией (не сглаживание). Решение:
   * честнее показать каждую реальную mock-точку, чем синтезировать «combined band»
   * усреднением — единого overall из одной попытки не бывает (R и L — разные тесты).
   * Серия смешивает R и L, потому что каждый mock-band = свидетельство общего уровня,
   * а официальный overall IELTS = среднее секций, так что смешанная серия естественно
   * центрируется на реальном overall. Цвет точки берёт UI из `section`.
   *
   * ВНИМАНИЕ: это облако СВИДЕТЕЛЬСТВ, а не временной ряд одной величины — соседние
   * точки бывают из разных тестов. Ломаная через него врёт про переход, которого не
   * было (Reading 3.5 сразу за Listening 2.0 рисовался «башней»). Для ЛИНИИ есть
   * `buildOverallSeries`; для дельт — сравнивать в пределах своей секции.
   */
  combined: TrajectoryPoint[];
  /** reading-подмножество combined — для split-линии/легенды. */
  reading: TrajectoryPoint[];
  /** listening-подмножество combined. */
  listening: TrajectoryPoint[];
}

/**
 * ЧИСТАЯ сборка серий из уже загруженных попыток. Отбрасывает точки без band или без
 * submittedAt (нечего/некуда рисовать). Сортировка по возрастанию времени (линия
 * слева→направо); детерминированный tiebreak (t, band, section) — одинаковый вход
 * всегда даёт идентичный выход.
 */
export function buildTrajectory(attempts: TrajectoryAttempt[]): Trajectory {
  const combined: TrajectoryPoint[] = [];
  for (const a of attempts) {
    if (a.bandScore == null) continue;
    const t = toMs(a.submittedAt);
    if (t == null) continue;
    combined.push({ t, band: a.bandScore, section: a.section });
  }
  combined.sort(
    (a, b) => a.t - b.t || a.band - b.band || a.section.localeCompare(b.section),
  );
  return {
    combined,
    reading: combined.filter((p) => p.section === "reading"),
    listening: combined.filter((p) => p.section === "listening"),
  };
}

/* -------------------------------------------------------------------------- */
/* buildOverallSeries — «настоящий» overall во времени (линия графика)         */
/* -------------------------------------------------------------------------- */

/** Точка overall-линии. Секции нет: величина ДЕРИВАТИВНАЯ, а не отдельный мок. */
export interface OverallPoint {
  t: number;
  band: number;
}

/**
 * Overall band во времени: на момент каждого мока — среднее ПОСЛЕДНИХ известных секций,
 * округлённое к 0.5 (как официальный overall IELTS).
 *
 * Зачем отдельно от `combined`: линия имеет смысл только для ОДНОЙ измеряемой
 * величины. `combined` — две переплетённые (R и L — разные тесты), поэтому любая
 * ломаная через него кодирует несуществующий переход. Здесь величина одна, и отрезок
 * между точками честно значит «твой overall изменился вот так».
 *
 * Почему это НЕ противоречит «единого overall из одной попытки не бывает» (см. docblock
 * модуля): мы и не берём его из одной попытки. Официальный overall = среднее секций,
 * сданных на РАЗНЫХ тестах одной сессии; здесь тот же приём — последний известный
 * результат по каждой секции.
 *
 * Пока сдана ОДНА секция, overall равен ей: это лучшая оценка из того, что известно, и
 * ровно та же конвенция, по которой уже живёт `buildReadiness` (`mean(present)` — среднее
 * ПРИСУТСТВУЮЩИХ скиллов, не всех четырёх). Альтернатива — не рисовать линию до второй
 * секции — была хуже: у студента, сдававшего сначала только Listening, «его band» появлялся
 * лишь на последней пятой части графика. Ступенька в момент первого мока второй секции
 * честна: это не скачок способностей, а приход новой информации.
 *
 * Прогноз (`computeForecast`) сознательно продолжает есть сырой `combined`: регрессия
 * через смешанное облако центрируется на overall, и трогать её не просили.
 */
export function buildOverallSeries(combined: TrajectoryPoint[]): OverallPoint[] {
  const out: OverallPoint[] = [];
  let lastReading: number | null = null;
  let lastListening: number | null = null;

  for (const p of combined) {
    if (p.section === "reading") lastReading = p.band;
    else lastListening = p.band;

    const known = [lastReading, lastListening].filter((b): b is number => b != null);
    const band = roundHalf(known.reduce((s, b) => s + b, 0) / known.length);
    // Два мока с одним timestamp дали бы две точки на одном x — вертикальный отрезок,
    // которого линия не описывает. Держим последнее известное состояние на момент t.
    if (out.length > 0 && out[out.length - 1].t === p.t) out[out.length - 1] = { t: p.t, band };
    else out.push({ t: p.t, band });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* computeForecast — проекция band на день экзамена                            */
/* -------------------------------------------------------------------------- */

/** Уровень доверия по числу banded-точек. UI выбирает заглушку/дисклеймер. */
export type ForecastStatus = "insufficient" | "low_confidence" | "ok";

/** Вердикт темпа относительно target. */
export type ForecastVerdict =
  | "reached" // последний фактический band уже ≥ target
  | "on_track" // проекция на день экзамена ≥ target
  | "behind" // проекция < target
  | "no_target" // target не задан
  | "insufficient"; // данных < порога — темп судить нельзя

export interface ForecastPoint {
  /** epoch ms сабмита. */
  t: number;
  band: number;
}

export interface Forecast {
  status: ForecastStatus;
  pointCount: number;
  /** clamp[4,9] + 0.5-шаг; null при insufficient. */
  projectedBand: number | null;
  /** доверительный коридор из разброса остатков; null при insufficient. */
  interval: { low: number; high: number } | null;
  verdict: ForecastVerdict;
  trend: "up" | "down" | "flat";
  /** наклон в band за 7 дней (для читаемой подписи «+0.3 band/нед»); null при insufficient. */
  slopePerWeek: number | null;
  /** дата, на которую спроецирован band ('YYYY-MM-DD' UTC); null при insufficient. */
  horizonDate: string | null;
  /** exam_date — если задана и в будущем; иначе прогноз на +30 дней от now. */
  horizonSource: "exam_date" | "default_30d";
  /** последний фактический band (хронологически поздняя точка); null при пустом входе. */
  latestBand: number | null;
  targetBand: number | null;
}

const MIN_POINTS_OK = 5; // ≥5 → 'ok'
const MIN_POINTS_FORECAST = 3; // <3 → 'insufficient'
const DEFAULT_HORIZON_DAYS = 30; // прогноз без exam_date
const MIN_HALF_WIDTH = 0.5; // минимальный полукоридор — band нельзя предсказать точнее ±0.5
const MIN_TIME_SPAN_DAYS = 1; // < суток разброса по времени → наклон неидентифицируем (вырождение)
const FLAT_PER_MONTH = 0.25; // |наклон за 30 дней| < порога → тренд 'flat'

/**
 * Продуктовый предохранитель против extrapolation trap. Короткий крутой ранний тренд
 * (напр. band 2.0→3.5 за пару недель), линейно продолженный OLS на дальний горизонт
 * (~75 дней), упирается в верхний кламп и рисует «прогноз 9.0» ученику с band 3 —
 * математически это честный OLS+кламп, но продуктово выглядит сломанным и подрывает
 * доверие. Ограничиваем |проекция − последний фактический band| приростом, реально
 * достижимым за оставшееся до горизонта время. Наклон/тренд НЕ капим — они отражают
 * наблюдаемый факт, ограничивается только проекция.
 *
 * Темп — ТИР по последнему фактическому band: реальная скорость прироста IELTS падает с
 * ростом уровня. Крупнейшие приросты у стартующих <5.5 (ielts.org: наибольший рост даёт
 * начальный этап), а к верху шкалы часы на ту же +0.5 растут нелинейно (Pearson GSE:
 * guided-learning-hours на полосу выше у продвинутых). Значения — полос/МЕСЯЦ, /30 → в день.
 */
export function maxBandGainPerDay(lastActual: number): number {
  const perMonth = lastActual < 5.5 ? 0.5 : lastActual < 7.0 ? 0.4 : 1 / 3;
  return perMonth / 30;
}

/**
 * Безусловный потолок СУММАРНОГО прироста проекции — против линейного накопления тирового
 * темпа на дальнем горизонте (иначе год ≈ +4–6 полос). Даже экстремальный задокументированный
 * случай ≈ 1.0 полоса за 3 месяца, поэтому +2.0 суммарно — заведомо щедрый backstop.
 * Симметричен: гасит и неправдоподобно крутой прогнозный спад на дальнем горизонте.
 */
const ABS_MAX_BAND_GAIN = 2.0;

/** Максимальный представимый сдвиг проекции: тировый темп × дни, но не более абс-лимита. */
export function maxForecastBandGain(lastActual: number, days: number): number {
  return Math.min(maxBandGainPerDay(lastActual) * Math.max(0, days), ABS_MAX_BAND_GAIN);
}

/**
 * Критические значения t-распределения Стьюдента для two-sided 80% доверия
 * (верхний хвост 0.10, t_{0.90, df}). Захардкожены для малых df: вход капнут 20 у
 * вызывающей стороны → df ≤ 19 (intercept-only n−1) / ≤ 18 (OLS n−2); таблица до 30 с
 * запасом, за её пределами — z_{0.90}. Без внешних зависимостей: полноценная обратная
 * t-CDF ради двух десятков строк не оправдана (YAGNI).
 */
const T_QUANTILE_80: Record<number, number> = {
  1: 3.078, 2: 1.886, 3: 1.638, 4: 1.533, 5: 1.476,
  6: 1.44, 7: 1.415, 8: 1.397, 9: 1.383, 10: 1.372,
  11: 1.363, 12: 1.356, 13: 1.35, 14: 1.345, 15: 1.341,
  16: 1.337, 17: 1.333, 18: 1.33, 19: 1.328, 20: 1.325,
  21: 1.323, 22: 1.321, 23: 1.319, 24: 1.318, 25: 1.316,
  26: 1.315, 27: 1.314, 28: 1.313, 29: 1.311, 30: 1.31,
};
const Z_QUANTILE_80 = 1.2817; // t при df→∞ (нормальное приближение)

/** t_{0.90, df} для two-sided 80% интервала; вне таблицы — нормальный квантиль. */
function tQuantile80(df: number): number {
  return T_QUANTILE_80[df] ?? Z_QUANTILE_80;
}

/**
 * ЧИСТАЯ проекция band на день экзамена по МНК-регрессии (band ~ время).
 *
 * Метод: обычная линейная регрессия (OLS) в единицах дней. Решение — не взвешивать
 * к недавним: вход уже ограничен последним окном (cap 20 у вызывающей стороны),
 * точек мало (3–20), а half-life рекуррентного веса — это скрытый тюнинг-параметр без
 * основания на таком объёме данных (YAGNI). Коридор — доверительный интервал предсказания
 * на объявленном уровне 80% (two-sided): halfWidth = t(df)·SE, где
 * SE = residualStd·√(1 + 1/n + (x₀−x̄)²/Sₓₓ) для OLS. Уровень 80% выбран сознательно —
 * для продукта это честный «вероятный коридор», а не почти-детерминированные 95%, которые
 * на 3–5 точках раздули бы интервал до всей шкалы. Множитель t(df) сам расширяет коридор
 * при малых df, поэтому отдельного ad-hoc-штрафа за low_confidence нет. Пол коридора ±0.5 —
 * band в принципе не предсказуем точнее полушкалы даже при идеально линейной истории.
 *
 * Вырожденный вход (все попытки в пределах < суток, наклон по времени неидентифицируем):
 * модель падает на intercept-only (плоская линия на среднем), df=n−1,
 * SE = residualStd·√(1 + 1/n), а статус НЕ поднимается выше low_confidence при любом n —
 * пять попыток в один день не дают доверия к темпу.
 *
 * @param points банд-точки с epoch-ms датами (обычно trajectory.combined).
 * @param examDate 'YYYY-MM-DD' | null — целевая дата экзамена.
 * @param targetBand целевой band | null.
 * @param now опорное «сейчас» (для детерминированных ре-ранов и горизонта +30 дней).
 */
export function computeForecast(
  points: ReadonlyArray<ForecastPoint>,
  examDate: string | null,
  targetBand: number | null,
  now: Date = new Date(),
): Forecast {
  // Сортируем по времени по возрастанию — вход может прийти в любом порядке, а
  // latestBand и origin зависят от хронологии.
  const pts = [...points].sort((a, b) => a.t - b.t);
  const n = pts.length;
  const latestBand = n > 0 ? pts[n - 1].band : null;

  // Горизонт: exam_date в будущем → на неё; иначе +30 дней от now. Прошедшая/битая
  // дата экзамена бесполезна как горизонт — падаем на дефолт (честнее «~месяц», чем
  // проекция в прошлое).
  const nowMs = now.getTime();
  const examMs = examDate ? Date.parse(`${examDate}T00:00:00Z`) : NaN;
  const useExam = Number.isFinite(examMs) && examMs > nowMs;
  const horizonMs = useExam ? examMs : nowMs + DEFAULT_HORIZON_DAYS * DAY_MS;
  const horizonSource: Forecast["horizonSource"] = useExam ? "exam_date" : "default_30d";

  // Порог данных: <3 точек — темп судить нельзя, отдаём заглушку без числа.
  if (n < MIN_POINTS_FORECAST) {
    return {
      status: "insufficient",
      pointCount: n,
      projectedBand: null,
      interval: null,
      verdict: "insufficient",
      trend: "flat",
      slopePerWeek: null,
      horizonDate: null,
      horizonSource,
      latestBand,
      targetBand,
    };
  }

  // OLS в днях от первой точки.
  const originMs = pts[0].t;
  const xs = pts.map((p) => (p.t - originMs) / DAY_MS);
  const ys = pts.map((p) => p.band);
  const xbar = mean(xs);
  const ybar = mean(ys);

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xbar;
    sxx += dx * dx;
    sxy += dx * (ys[i] - ybar);
  }

  // Разброс по времени = xs[n−1] (pts отсортированы, xs[0]=0). Меньше суток → наклон по
  // времени неидентифицируем (sxx≈0, деление sxy/sxx взорвало бы наклон в дикую
  // экстраполяцию): падаем на intercept-only (плоская линия на среднем) и НЕ поднимаем
  // статус выше low_confidence, сколько бы точек ни было — пять попыток за один день не
  // доказывают темп.
  const degenerate = xs[n - 1] < MIN_TIME_SPAN_DAYS;

  const status: ForecastStatus =
    degenerate || n < MIN_POINTS_OK ? "low_confidence" : "ok";

  const slope = degenerate ? 0 : sxy / sxx;
  const intercept = ybar - slope * xbar;

  let ssResid = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (intercept + slope * xs[i]);
    ssResid += r * r;
  }
  // df: OLS оценивает 2 параметра (наклон+сдвиг) → n−2; intercept-only — только среднее → n−1.
  // Здесь n ≥ 3 (порог insufficient уже пройден), значит df ≥ 1 всегда.
  const df = degenerate ? n - 1 : n - 2;
  const residualStd = Math.sqrt(ssResid / df);

  const x0 = (horizonMs - originMs) / DAY_MS;
  const projectedRaw = intercept + slope * x0;

  // Полуширина = t(df)·SE предсказания на 80% доверии. SE OLS растёт при малом n и
  // экстраполяции за пределы данных; intercept-only — без leverage-члена (наклон не
  // оценивался). t(df) сам расширяет коридор при малых df, поэтому прежний ×1.5 при
  // low_confidence убран как двойной штраф. Пол ±0.5 оставлен — это утверждение о шкале
  // band (точнее полушкалы не предскажешь), а не о размере выборки.
  const sePred = degenerate
    ? residualStd * Math.sqrt(1 + 1 / n)
    : residualStd * Math.sqrt(1 + 1 / n + ((x0 - xbar) * (x0 - xbar)) / sxx);
  const halfWidth = Math.max(MIN_HALF_WIDTH, tQuantile80(df) * sePred);

  // Предохранитель от extrapolation trap (см. maxBandGainPerDay): OLS на коротком крутом
  // окне спроецировал бы нереальный прирост на дальний горизонт. Ограничиваем сдвиг
  // проекции относительно ПОСЛЕДНЕГО фактического band тировым темпом за оставшееся до
  // горизонта время, но не более ABS_MAX_BAND_GAIN суммарно (симметрично — гасит и дикий
  // спад). И точку, И коридор центрируем на капнутом значении: уровень неопределённости
  // (halfWidth) прежний, сдвигается только центр, иначе коридор остался бы вокруг дикого
  // projectedRaw.
  const lastActual = pts[n - 1].band;
  const daysToHorizon = Math.max(0, (horizonMs - pts[n - 1].t) / DAY_MS);
  const maxGain = maxForecastBandGain(lastActual, daysToHorizon);
  const projectedCapped = Math.min(
    lastActual + maxGain,
    Math.max(lastActual - maxGain, projectedRaw),
  );

  // clampRoundBand округляет к БЛИЖАЙШЕЙ 0.5 — на коротком горизонте это округлило бы
  // капнутую точку НАРУЖУ окна капа (напр. lastActual 7.0, maxGain 0.267 → 7.267 → 7.5),
  // пробив заявленный потолок прироста и ложно завысив вердикт. Дожимаем ТОЧКУ в окно
  // капа, округлённое ВНУТРЬ к сетке 0.5 (коридор НЕ трогаем — он про неопределённость,
  // ему шире окна можно). При band на сетке 0.5 gainLow ≤ lastActual ≤ gainHigh (инверсии
  // нет); maxGain<0.5 схлопывает окно к lastActual — честно для ультра-короткого горизонта.
  // Финальный clampRoundBand держит контракт [4,9] (дожатие к lastActual<4 иначе пробило бы
  // нижний кламп на band-2–3 истории с коротким горизонтом).
  const gainLow = ceilHalf(lastActual - maxGain);
  const gainHigh = floorHalf(lastActual + maxGain);
  // Инверсия окна (gainLow > gainHigh): при off-grid lastActual и maxGain < 0.5 ни одной
  // 0.5-полосы не попадает СТРОГО в допустимый прирост (изменение < шага сетки band в принципе
  // непредставимо). Честный представимый прогноз = ближайшая к lastActual полоса — «band не
  // сдвинулся», а не продавленный к дальней границе окна (иначе отклонение превысило бы кап).
  const projectedBand =
    gainLow > gainHigh
      ? clampRoundBand(roundHalf(lastActual))
      : clampRoundBand(Math.min(gainHigh, Math.max(gainLow, clampRoundBand(projectedCapped))));
  const interval = {
    low: clampRoundBand(projectedCapped - halfWidth),
    high: clampRoundBand(projectedCapped + halfWidth),
  };

  // Тренд по наклону за 30 дней (порог ±0.25 отсекает шум как «flat»).
  const perMonth = slope * 30;
  const trend: Forecast["trend"] =
    perMonth > FLAT_PER_MONTH ? "up" : perMonth < -FLAT_PER_MONTH ? "down" : "flat";

  // Вердикт: reached — по ФАКТИЧЕСКОМУ последнему band (не проекции); on_track — если
  // проекция дотягивает до target; иначе behind.
  let verdict: ForecastVerdict;
  if (targetBand == null) verdict = "no_target";
  else if (latestBand != null && latestBand >= targetBand) verdict = "reached";
  else if (projectedBand >= targetBand) verdict = "on_track";
  else verdict = "behind";

  return {
    status,
    pointCount: n,
    projectedBand,
    interval,
    verdict,
    trend,
    slopePerWeek: Math.round(slope * 7 * 100) / 100,
    horizonDate: toIsoDate(horizonMs),
    horizonSource,
    latestBand,
    targetBand,
  };
}

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return xs.length > 0 ? s / xs.length : 0;
}

/* -------------------------------------------------------------------------- */
/* buildReadiness — готовность по 4 скиллам                                    */
/* -------------------------------------------------------------------------- */

export type Skill = "reading" | "listening" | "writing" | "speaking";

export interface ReadinessInput {
  /** последний band reading-секции (из траектории). */
  reading: number | null;
  /** последний band listening-секции. */
  listening: number | null;
  /**
   * последний band Writing-сабмита. Добывает UI-слой owner-путём из
   * writing_feedback (band_low/band_high — числовые колонки; берётся представитель,
   * например середина диапазона). Здесь — уже число/null.
   */
  writing: number | null;
  /** последний band Speaking-сабмита (аналогично, из speaking_feedback). */
  speaking: number | null;
  targetBand: number | null;
}

export interface SkillReadiness {
  skill: Skill;
  band: number | null;
  /** band ≥ target (оба заданы). */
  met: boolean;
  /** target − band (оба заданы): >0 — не дотянул, ≤0 — с запасом; null если чего-то нет. */
  gap: number | null;
}

export interface Readiness {
  /** всегда 4 записи в порядке R, L, W, S. */
  skills: SkillReadiness[];
  /**
   * overall = среднее ДОСТУПНЫХ скилл-band, округлённое к 0.5 (как overall IELTS).
   * При < 4 заданных — это ЧАСТИЧНАЯ оценка (см. skillsCounted), не настоящий overall.
   * Не клампим в [4,9] — историческая правда важнее косметики (кламп — только у прогноза).
   */
  overallBand: number | null;
  /** сколько из 4 скиллов имеют band (0–4). */
  skillsCounted: number;
  targetBand: number | null;
}

/**
 * ЧИСТАЯ сборка готовности. Решение по R/L: берём ПОСЛЕДНИЙ band секции, не среднее
 * последних двух — свежий полный mock честнее отражает текущий уровень, а усреднение
 * размывает недавний рост. W/S приходят уже числом (их достаёт UI из *_feedback).
 */
export function buildReadiness(input: ReadinessInput): Readiness {
  const { targetBand } = input;
  const order: Array<[Skill, number | null]> = [
    ["reading", input.reading],
    ["listening", input.listening],
    ["writing", input.writing],
    ["speaking", input.speaking],
  ];

  const skills: SkillReadiness[] = order.map(([skill, band]) => ({
    skill,
    band,
    met: band != null && targetBand != null && band >= targetBand,
    gap: band != null && targetBand != null ? targetBand - band : null,
  }));

  const present = skills.map((s) => s.band).filter((b): b is number => b != null);
  const overallBand = present.length > 0 ? roundHalf(mean(present)) : null;

  return { skills, overallBand, skillsCounted: present.length, targetBand };
}
