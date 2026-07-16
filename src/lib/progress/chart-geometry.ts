/**
 * Чистая серверная геометрия Trajectory-графика (герой «Траектория» на Overview).
 * Вынесена из TrajectoryHero (app/app/progress/OverviewPanel.tsx) без изменений в
 * формулах — только оформление контракта: панель теперь один раз собирает
 * ChartGeometryInput и дважды вызывает buildChartGeometry (десктоп/мобильный
 * viewBox), как раньше дважды звался geomFor. Модуль чистый: без React/JSX, без
 * side effects, без обращений к Date.now()/env — единственное параметрируемое
 * «сейчас» приходит извне как nowMs.
 */
import type { Trajectory, TrajectoryPoint, Forecast } from "./overview";

// Padding общий для обоих форматов графика; размеры холста (viewBox) — параметры
// buildChartGeometry: широкий на десктопе, более квадратный в мобильном портрете
// (чтобы график не превращался в узкую полоску на телефоне).
export const PAD = { l: 44, r: 18, t: 18, b: 28 };
export const CHART_DESKTOP = { w: 680, h: 272 };
export const CHART_MOBILE = { w: 440, h: 320 };

const DAY_MS = 86_400_000;

// timeZone: "UTC" — сервер энв-независим (прод и так UTC, но dev-машина может быть
// в другом поясе): один и тот же ms всегда даёт один и тот же текст, откуда бы ни
// шёл рендер. Клиент поверх этого базлайна переформатирует в TZ браузера после
// маунта (TrajectoryChart.tsx) — здесь только SSR-инвариантный формат.
export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Гасит подпись, РАВНУЮ последней сохранённой НЕпогашенной подписи — только вперёд
 * по массиву (не глобальный дедуп). На окне короче ~2 суток соседние засечки
 * округляются до одного календарного дня и печатали дубль «Jul 14 / Jul 14»,
 * который читается как баг: точка/вертикаль сетки остаётся, пропадает только текст.
 * ВНИМАНИЕ (сохранено намеренно): "прошлая сохранённая" обновляется на КАЖДОЙ
 * неравной подписи, включая уже погашенную ("") — т.е. случай [A, "", A] НЕ гасит
 * второй "A" (после первого дедупа prevLabel становится "", а "A" ей не равна).
 */
export function dedupeConsecutiveLabels(labels: string[]): string[] {
  if (labels.length === 0) return [];
  const out = [...labels];
  let prevLabel = out[0];
  for (let i = 1; i < out.length; i++) {
    if (out[i] === prevLabel) out[i] = "";
    else prevLabel = out[i];
  }
  return out;
}

interface Scaled {
  x: number;
  y: number;
}

function scalePoints(pts: TrajectoryPoint[], xScale: (t: number) => number, yScale: (b: number) => number): Scaled[] {
  return pts.map((p) => ({ x: xScale(p.t), y: yScale(p.band) }));
}

// Прямая полилиния через реальные точки — вариант 3 «научный/точный» (решение
// владельца, chart-styles-preview.html): без интерполяции curve.ts, прямые сегменты
// между соседними моками не могут провиснуть или перелететь данные — между точками
// попросту нет кривизны, только отрезок.
const polyD = (pts: Scaled[]): string => {
  if (pts.length === 0) return "";
  const [first, ...rest] = pts;
  let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (const p of rest) d += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  return d;
};

export interface ChartGeometryInput {
  trajectory: Trajectory;
  forecast: Pick<Forecast, "status" | "projectedBand">;
  targetBand: number | null;
  examDate: string | null; // 'YYYY-MM-DD'
  nowMs: number;
}

export interface ChartGeom {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  combined: { x: number; y: number; band: number; dateMs: number; section: "reading" | "listening" }[];
  line: { path: string } | null;
  reading: { path: string } | null;
  listening: { path: string } | null;
  pointXs: number[];
  grid: { band: number; y: number }[];
  target: { y: number; band: number } | null;
  targetEdge: { band: number; above: boolean } | null;
  exam: { x: number; rightEdge: boolean } | null;
  forecast: { lastX: number; lastY: number; horizonX: number; projY: number; clamped: boolean; band: number } | null;
  xTicks: { x: number; tMs: number; label: string }[];
  latest: { x: number; y: number; band: number; section: "reading" | "listening" };
}

/**
 * Геометрия для конкретного размера холста (viewBox). Домен (Y/X-окно, экзамен,
 * прогноз-флаг — всё, что не зависит от размера) считается один раз на вход;
 * здесь — шкалы/пути/координаты. Вызывается дважды на страницу: широкий десктоп и
 * более квадратный мобильный, чтобы график в портрете не был узкой полоской.
 */
export function buildChartGeometry(input: ChartGeometryInput, size: { w: number; h: number }): ChartGeom {
  const { trajectory, forecast, targetBand, examDate, nowMs } = input;
  const { w: CW, h: CH } = size;
  const pts = trajectory.combined;
  if (pts.length === 0) {
    throw new Error("buildChartGeometry: trajectory.combined must not be empty — caller gates the empty-state before calling");
  }

  // Y domain — окно обнимает ТОЛЬКО баллы моков + запас, округлённо по сетке 0.5,
  // в пределах band [1,9]. Раньше ось жёстко держала весь диапазон 4–9 → низкие
  // плоские данные вжимались в самый низ, а верх пустовал. Далёкий target больше
  // НЕ растягивает окно — он уходит в бейдж у кромки плота (targetEdge ниже);
  // прогноз-стаб, если вылезает за окно, визуально клампится к кромке (там же).
  // Это окно обзора, НЕ шкала грейдинга — сами числа не меняются, только их
  // положение на холсте.
  const yVals = pts.map((p) => p.band);
  let yMin = Math.max(1, Math.floor((Math.min(...yVals) - 0.5) * 2) / 2);
  let yMax = Math.min(9, Math.ceil((Math.max(...yVals) + 0.5) * 2) / 2);
  // Гарантируем минимум ~2.5 балла по вертикали, иначе на плоских данных сетка
  // схлопывается в одну-две линии.
  if (yMax - yMin < 2.5) {
    yMax = Math.min(9, yMin + 2.5);
    yMin = Math.max(1, yMax - 2.5);
  }

  // X domain — ФОКУС НА СДАННЫХ МОКАХ. Это НЕ формула (грейдинг/прогноз/«до экзамена»
  // считаются так же), а окно обзора графика: ось охватывает моки + небольшой запас.
  // Горизонт прогноза и дата экзамена больше НЕ растягивают её на месяцы вперёд —
  // иначе свежие моки схлопываются в невидимую полоску у левого края. Полный прогноз
  // живёт в карточке Forecast; на графике — короткий пунктирный стаб + линия цели.
  const firstT = pts[0].t;
  const lastT = pts[pts.length - 1].t;
  const dataSpan = lastT - firstT;
  const leftPad = dataSpan > 0 ? Math.max(dataSpan * 0.06, 0.25 * DAY_MS) : 3 * DAY_MS;
  // Правый запас — только под короткий стаб прогноза. Жёсткий пол в 2 дня съедал
  // треть холста на коротком размахе моков (3 дня → 38% пустоты), поэтому он теперь
  // доля от размаха с маленьким полом.
  const rightPad = dataSpan > 0 ? Math.max(dataSpan * 0.18, 0.5 * DAY_MS) : 3 * DAY_MS;
  const xMin = firstT - leftPad;
  const xMax = lastT + rightPad;
  const examMs = examDate ? Date.parse(`${examDate}T00:00:00Z`) : NaN;

  const gridBands: number[] = [];
  for (let b = Math.ceil(yMin); b <= Math.floor(yMax); b++) gridBands.push(b);

  const last = pts[pts.length - 1];
  // Линия экзамена — только если дата попадает в окно моков; далёкий экзамен несёт
  // карточка Forecast («by …»), а не растянутая на месяцы ось.
  const examInWindow = Number.isFinite(examMs) && examMs > nowMs && examMs <= xMax;
  // Прогноз на графике — короткий пунктирный стаб к правому краю окна (не конус до
  // далёкого горизонта). Полный интервал/дата — в карточке Forecast.
  const showForecast = forecast.status !== "insufficient" && forecast.projectedBand != null;

  const PW = CW - PAD.l - PAD.r;
  const PH = CH - PAD.t - PAD.b;
  const xScale = (t: number) => PAD.l + ((t - xMin) / (xMax - xMin)) * PW;
  const yScale = (b: number) => PAD.t + (1 - (b - yMin) / (yMax - yMin)) * PH;
  const cPts = scalePoints(pts, xScale, yScale);
  const rPts = trajectory.reading.length >= 2 ? scalePoints(trajectory.reading, xScale, yScale) : null;
  const lPts = trajectory.listening.length >= 2 ? scalePoints(trajectory.listening, xScale, yScale) : null;
  // x-координаты всех моков — бледные вертикали сетки на КАЖДОЙ точке (вариант 3),
  // отдельно от равномерных xTicks. toFixed(1) дедупит два мока в один день (тот же
  // пиксель — вторая вертикаль поверх первой ничего не добавляет).
  const pointXs = Array.from(new Set(cPts.map((p) => Number(p.x.toFixed(1)))));
  const lastScaled = cPts[cPts.length - 1];
  // Пилюля текущего балла — band последнего мока. Сквозная линия ниже уже проходит
  // через каждый мок как есть, без усреднения R/L в отдельную величину. section
  // нужен клиенту, чтобы маркер «ты здесь» держал форму секции (круг/ромб), а не
  // только brand-заливку.
  const latest = { x: lastScaled.x, y: lastScaled.y, band: last.band, section: last.section };
  // Target внутри окна обзора — обычная пунктирная линия. Вне окна кламп-линия
  // читалась как «target почти достигнут» при разрыве в несколько банд (это ложь) —
  // вместо неё бейдж у кромки плота (targetEdge, above = цель выше видимого окна).
  const targetInWindow = targetBand != null && targetBand >= yMin && targetBand <= yMax;
  const targetY = targetInWindow ? yScale(targetBand!) : null;
  const examX = examInWindow ? xScale(examMs) : null;
  // Прогноз-стаб клампится в плот по уже посчитанному пикселю (не по band), потому
  // что projectedBand может лежать вне окна обзора — стаб визуально утыкается в
  // кромку плота, а не улетает за пределы холста. rawProjY (до клампа) нужен только
  // чтобы отличить «кламп сработал» — клиент рисует честный бейдж-стрелку со
  // значением band рядом со стабом, а не молча прижимает линию к кромке (на
  // растущих аккаунтах кламп-к-потолку читался как «уже у цели»).
  const rawProjY = showForecast ? yScale(forecast.projectedBand!) : null;
  const projY = showForecast ? Math.min(Math.max(rawProjY!, PAD.t), CH - PAD.b) : null;
  const projClamped = showForecast ? rawProjY! !== projY : false;
  // Засечки оси X: равномерно по домену. Раньше подписей было ровно две (по краям) —
  // между ними шкалу приходилось достраивать в уме, и поле читалось как «точки в
  // пустоте», а не как график. На узком мобильном холсте 4 подписи склеились бы — 3.
  const tickCount = CW >= 600 ? 4 : 3;
  // tMs — сырой t засечки, наружу (клиент переформатирует его в свою TZ после
  // маунта; см. dedupeConsecutiveLabels/TrajectoryChart.tsx). label здесь — SSR-
  // базлайн в UTC, дедупится ниже; время сознательно не добавляем: юзеру
  // «время мимо часов на стене».
  const xTicks = Array.from({ length: tickCount }, (_, i) => {
    const t = xMin + ((xMax - xMin) * i) / (tickCount - 1);
    return { x: xScale(t), tMs: t, label: fmtDate(t) };
  });
  const dedupedLabels = dedupeConsecutiveLabels(xTicks.map((tk) => tk.label));
  for (let i = 0; i < xTicks.length; i++) xTicks[i] = { ...xTicks[i], label: dedupedLabels[i] };
  return {
    w: CW,
    h: CH,
    padL: PAD.l,
    padR: PAD.r,
    padT: PAD.t,
    padB: PAD.b,
    combined: pts.map((p, i) => ({ x: cPts[i].x, y: cPts[i].y, band: p.band, dateMs: p.t, section: p.section })),
    // Сквозная линия — band каждого мока подряд, хронологически (см. polyD выше).
    line: cPts.length >= 2 ? { path: polyD(cPts) } : null,
    reading: rPts ? { path: polyD(rPts) } : null,
    listening: lPts ? { path: polyD(lPts) } : null,
    pointXs,
    grid: gridBands.map((b) => ({ band: b, y: yScale(b) })),
    target: targetY != null ? { y: targetY, band: targetBand! } : null,
    targetEdge: targetBand != null && !targetInWindow ? { band: targetBand, above: targetBand > yMax } : null,
    exam: examX != null ? { x: examX, rightEdge: examX > CW - PAD.r - 28 } : null,
    forecast: showForecast
      ? { lastX: lastScaled.x, lastY: lastScaled.y, horizonX: CW - PAD.r, projY: projY!, clamped: projClamped, band: forecast.projectedBand! }
      : null,
    xTicks,
    latest,
  };
}
