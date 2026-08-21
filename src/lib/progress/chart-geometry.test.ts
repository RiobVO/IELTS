import { describe, it, expect } from "vitest";
import { buildTrajectory, computeForecast, type Trajectory, type TrajectoryAttempt, type Forecast } from "./overview";
import { buildChartGeometry, dedupeConsecutiveLabels, CHART_DESKTOP, CHART_MOBILE, type ChartGeom } from "./chart-geometry";

// Всё время в тестах — от фиксированной точки, никакого Date.now() (детерминизм).
const NOW_MS = Date.parse("2026-07-15T12:00:00Z");
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const EPS = 1e-6;
// Чуть шире EPS — для сумм/делений с накоплением погрешности плавающей точки
// (шаг xTicks, восстановление Y-окна из grid).
const EPS_LOOSE = 1e-3;
// Допуск восстановления временного окна (recoverXWindow) — тот же, что у
// регресс-пина X-домена ниже: xScale — деление в пикселях, обратное решение
// накапливает суб-миллисекундную погрешность на широких доменах.
const T_TOL_MS = 1000;

const SIZES = [CHART_DESKTOP, CHART_MOBILE] as const;

const INSUFFICIENT_FORECAST: Pick<Forecast, "status" | "projectedBand"> = {
  status: "insufficient",
  projectedBand: null,
};

function attempt(band: number, section: "reading" | "listening", t: number): TrajectoryAttempt {
  return { bandScore: band, section, submittedAt: new Date(t) };
}

function toIsoDateUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function geomFor(
  trajectory: Trajectory,
  forecast: Pick<Forecast, "status" | "projectedBand">,
  targetBand: number | null,
  examDate: string | null,
  size: { w: number; h: number },
): ChartGeom {
  return buildChartGeometry({ trajectory, forecast, targetBand, examDate, nowMs: NOW_MS }, size);
}

/* -------------------------------------------------------------------------- */
/* mulberry32 — ручной детерминированный PRNG (без Math.random)                */
/* -------------------------------------------------------------------------- */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------- */
/* Парсер SVG-полилинии "M x y L x y L x y …" (формат polyD в chart-geometry). */
/* -------------------------------------------------------------------------- */

function parsePath(d: string): { x: number; y: number }[] {
  const re = /[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g;
  const out: { x: number; y: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push({ x: Number(m[1]), y: Number(m[2]) });
  return out;
}

/**
 * Восстанавливает Y-окно [yMin, yMax] из двух соседних узлов сетки (band целый,
 * шаг 1). yScale(b0)−yScale(b1) = PH/(yMax−yMin) при b1=b0+1 — точное решение,
 * не оценка. Предполагает валидный geom (grid.length≥2, y0>y1) — вызывающая
 * сторона (assertInvariants) проверяет это сама и падает с ctx при нарушении.
 */
function recoverYWindow(geom: Pick<ChartGeom, "grid" | "padT" | "h" | "padB">): { yMin: number; yMax: number } {
  const PH = geom.h - geom.padT - geom.padB;
  const [g0, g1] = geom.grid;
  const yRange = PH / (g0.y - g1.y);
  const yMin = g0.band - (yRange * (geom.padT + PH - g0.y)) / PH;
  return { yMin, yMax: yMin + yRange };
}

/**
 * Восстанавливает временное окно [xMin, xMax] из двух точек (t,x) с РАЗНЫМ t —
 * обратное решение линейной xScale (тот же приём, что recoverYWindow для Y).
 * Требует p1.t !== p2.t (иначе k = 0/0 = NaN) — вызывающая сторона обязана
 * гарантировать ненулевой временной размах сама (span=0 — отдельная ветка,
 * см. регресс-пин ниже, случай «в»). Используется и общим assertInvariants
 * (инвариант tMs), и именованным регресс-пином X-домена.
 */
function recoverXWindow(
  p1: { t: number; x: number },
  p2: { t: number; x: number },
  geom: Pick<ChartGeom, "padL" | "padR" | "w">,
): { xMin: number; xMax: number } {
  const PW = geom.w - geom.padL - geom.padR;
  const k = (p2.x - p1.x) / (p2.t - p1.t);
  const xMin = p1.t - (p1.x - geom.padL) / k;
  return { xMin, xMax: xMin + PW / k };
}

/* -------------------------------------------------------------------------- */
/* assertInvariants — единая проверка всех 10 инвариантов геометрии.           */
/* -------------------------------------------------------------------------- */

function assertInvariants(geom: ChartGeom, ctx: string): void {
  const fail = (msg: string): never => {
    throw new Error(`assertInvariants[${ctx}]: ${msg}`);
  };
  const finite = (x: number, label: string) => {
    if (!Number.isFinite(x)) fail(`${label} не конечно: ${x}`);
  };
  const { w, h, padL, padR, padT, padB, combined, line, reading, listening, pointXs, grid, target, targetEdge, exam, forecast, xTicks, latest } =
    geom;

  // 1. Маркеры (combined) внутри рамки плота.
  for (const p of combined) {
    if (!(p.y >= padT - EPS && p.y <= h - padB + EPS)) fail(`combined y=${p.y} за рамкой [${padT}, ${h - padB}]`);
    if (!(p.x >= padL - EPS && p.x <= w - padR + EPS)) fail(`combined x=${p.x} за рамкой [${padL}, ${w - padR}]`);
  }

  // 2. Вершины сквозной/секционных полилиний = точки combined (с точностью toFixed(1)).
  const checkPolyline = (pathObj: { path: string } | null, expected: { x: number; y: number }[], label: string) => {
    if (!pathObj) return;
    const verts = parsePath(pathObj.path);
    if (verts.length !== expected.length) fail(`${label}: вершин ${verts.length}, ожидалось ${expected.length}`);
    for (let i = 0; i < verts.length; i++) {
      finite(verts[i].x, `${label}[${i}].x`);
      finite(verts[i].y, `${label}[${i}].y`);
      if (!(verts[i].x >= -EPS && verts[i].x <= w + EPS)) fail(`${label}[${i}].x=${verts[i].x} вне [0,${w}]`);
      if (!(verts[i].y >= -EPS && verts[i].y <= h + EPS)) fail(`${label}[${i}].y=${verts[i].y} вне [0,${h}]`);
      if (Math.abs(verts[i].x - expected[i].x) > 0.05 + EPS) fail(`${label}[${i}].x=${verts[i].x} !~ ${expected[i].x}`);
      if (Math.abs(verts[i].y - expected[i].y) > 0.05 + EPS) fail(`${label}[${i}].y=${verts[i].y} !~ ${expected[i].y}`);
    }
  };
  checkPolyline(line, combined, "line");
  checkPolyline(
    reading,
    combined.filter((p) => p.section === "reading"),
    "reading",
  );
  checkPolyline(
    listening,
    combined.filter((p) => p.section === "listening"),
    "listening",
  );

  // 3. Нет NaN/Infinity среди прочих числовых полей.
  for (const p of combined) {
    finite(p.x, "combined.x");
    finite(p.y, "combined.y");
    finite(p.band, "combined.band");
    finite(p.dateMs, "combined.dateMs");
  }
  for (const g of grid) {
    finite(g.y, "grid.y");
    finite(g.band, "grid.band");
  }
  for (const x of pointXs) finite(x, "pointXs");
  for (const t of xTicks) {
    finite(t.x, "xTicks.x");
    finite(t.tMs, "xTicks.tMs");
  }
  if (target) finite(target.y, "target.y");
  if (exam) finite(exam.x, "exam.x");
  if (forecast) {
    finite(forecast.lastX, "forecast.lastX");
    finite(forecast.lastY, "forecast.lastY");
    finite(forecast.horizonX, "forecast.horizonX");
    finite(forecast.projY, "forecast.projY");
    finite(forecast.band, "forecast.band");
  }
  finite(latest.x, "latest.x");
  finite(latest.y, "latest.y");
  finite(latest.band, "latest.band");

  // 4. Y-окно, восстановленное из grid.
  if (grid.length < 3) fail(`grid.length=${grid.length} < 3 — минимальное окно 2.5 гарантирует ≥3 узла`);
  const PH = h - padT - padB;
  if (grid[0].y - grid[1].y <= EPS) fail(`grid не убывает по y между соседними бандами: y0=${grid[0].y} y1=${grid[1].y}`);
  const { yMin, yMax } = recoverYWindow(geom);
  const dataBands = combined.map((p) => p.band);
  const dataMin = Math.min(...dataBands);
  const dataMax = Math.max(...dataBands);
  if (!(yMin <= dataMin + EPS)) fail(`yMin=${yMin} > min(band данных)=${dataMin}`);
  if (!(yMax >= dataMax - EPS)) fail(`yMax=${yMax} < max(band данных)=${dataMax}`);
  if (!(yMin >= 1 - EPS)) fail(`yMin=${yMin} < 1`);
  if (!(yMax <= 9 + EPS)) fail(`yMax=${yMax} > 9`);
  if (!(yMax - yMin >= 2.5 - EPS)) fail(`окно ${yMax - yMin} < 2.5`);

  // 5. target: линия XOR бейдж (структурно — count ∈ {0,1}, никогда 2).
  const targetCount = (target != null ? 1 : 0) + (targetEdge != null ? 1 : 0);
  if (targetCount === 2) fail(`target и targetEdge одновременно non-null`);
  if (target) {
    if (!(target.y >= padT - EPS && target.y <= h - padB + EPS)) fail(`target.y=${target.y} за рамкой`);
  }
  if (targetEdge) {
    const expectedAbove = targetEdge.band > yMax;
    if (targetEdge.above !== expectedAbove) {
      fail(`targetEdge.above=${targetEdge.above}, ожидалось ${expectedAbove} (band=${targetEdge.band}, yMax=${yMax})`);
    }
  }

  // 6. Прогноз-стаб внутри плота; clamped/band согласованы с восстановленным
  // Y-окном — пересчитываем ТОТ ЖЕ yScale(band) независимо от geom, из yMin/yMax
  // восстановленных в п.4, и сверяем, что кламп сработал ровно тогда, когда сырой
  // Y вышел за рамку плота (±EPS).
  if (forecast) {
    if (!(forecast.projY >= padT - EPS && forecast.projY <= h - padB + EPS)) fail(`forecast.projY=${forecast.projY} за рамкой`);
    if (forecast.lastX !== latest.x) fail(`forecast.lastX=${forecast.lastX} !== latest.x=${latest.x}`);
    if (forecast.lastY !== latest.y) fail(`forecast.lastY=${forecast.lastY} !== latest.y=${latest.y}`);
    if (forecast.horizonX !== w - padR) fail(`forecast.horizonX=${forecast.horizonX} !== w-padR=${w - padR}`);
    const rawProjY = padT + (1 - (forecast.band - yMin) / (yMax - yMin)) * PH;
    const expectedClamped = rawProjY < padT - EPS || rawProjY > h - padB + EPS;
    if (forecast.clamped !== expectedClamped) {
      fail(`forecast.clamped=${forecast.clamped}, ожидалось ${expectedClamped} (rawProjY=${rawProjY}, band=${forecast.band})`);
    }
  }

  // 7. xTicks: длина, дедуп подряд-повторов, равномерный шаг, края у padL/(w-padR).
  const expectedTickCount = w >= 600 ? 4 : 3;
  if (xTicks.length !== expectedTickCount) fail(`xTicks.length=${xTicks.length} !== ${expectedTickCount}`);
  let lastNonEmpty: string | undefined;
  for (const tick of xTicks) {
    if (tick.label !== "") {
      if (tick.label === lastNonEmpty) fail(`xTicks дублирует подпись подряд: "${tick.label}"`);
      lastNonEmpty = tick.label;
    }
  }
  if (xTicks.length > 0) {
    if (Math.abs(xTicks[0].x - padL) > EPS_LOOSE) fail(`первая засечка x=${xTicks[0].x} !~ padL=${padL}`);
    if (Math.abs(xTicks[xTicks.length - 1].x - (w - padR)) > EPS_LOOSE) {
      fail(`последняя засечка x=${xTicks[xTicks.length - 1].x} !~ w-padR=${w - padR}`);
    }
    if (xTicks.length > 1) {
      const step = (xTicks[xTicks.length - 1].x - xTicks[0].x) / (xTicks.length - 1);
      for (let i = 1; i < xTicks.length; i++) {
        const d = xTicks[i].x - xTicks[i - 1].x;
        if (Math.abs(d - step) > EPS_LOOSE) fail(`шаг xTicks неравномерен на i=${i}: Δ=${d} vs ${step}`);
      }
    }
  }

  // 7b. xTicks.tMs — сырой t засечки (клиент переформатирует его в свою TZ):
  // шаг равномерен по времени, а крайние засечки совпадают с реальным X-доменом,
  // восстановленным ПО ДАННЫМ (recoverXWindow из combined[0]/combined[последняя]),
  // а не по собственной формуле xTicks — иначе баг в передаче tMs, совпадающий по
  // форме с багом в xScale, остался бы незамеченным. Восстановление требует
  // ненулевой временной размах данных (иначе naklon k=0/0=NaN) — при span=0 (все
  // моки в один момент) домен считается веткой ±3 дня, это отдельно покрыто
  // регресс-пином ниже (случай «в»), здесь просто пропускаем.
  if (xTicks.length > 1) {
    const tStep = (xTicks[xTicks.length - 1].tMs - xTicks[0].tMs) / (xTicks.length - 1);
    for (let i = 1; i < xTicks.length; i++) {
      const d = xTicks[i].tMs - xTicks[i - 1].tMs;
      if (Math.abs(d - tStep) > EPS_LOOSE) fail(`шаг xTicks.tMs неравномерен на i=${i}: Δ=${d} vs ${tStep}`);
    }
  }
  if (xTicks.length > 0 && combined[combined.length - 1].dateMs > combined[0].dateMs) {
    const recoveredX = recoverXWindow(
      { t: combined[0].dateMs, x: combined[0].x },
      { t: combined[combined.length - 1].dateMs, x: combined[combined.length - 1].x },
      geom,
    );
    if (Math.abs(xTicks[0].tMs - recoveredX.xMin) > T_TOL_MS) {
      fail(`xTicks[0].tMs=${xTicks[0].tMs} !~ восстановленный xMin=${recoveredX.xMin}`);
    }
    const lastTick = xTicks[xTicks.length - 1];
    if (Math.abs(lastTick.tMs - recoveredX.xMax) > T_TOL_MS) {
      fail(`xTicks[последняя].tMs=${lastTick.tMs} !~ восстановленный xMax=${recoveredX.xMax}`);
    }
  }

  // 8. pointXs — без дублей, все в рамке.
  if (new Set(pointXs).size !== pointXs.length) fail(`pointXs содержит дубли`);
  for (const x of pointXs) {
    if (!(x >= padL - EPS && x <= w - padR + EPS)) fail(`pointXs x=${x} за рамкой`);
  }

  // 9. latest === последняя точка combined.
  const lastCombined = combined[combined.length - 1];
  if (
    latest.x !== lastCombined.x ||
    latest.y !== lastCombined.y ||
    latest.band !== lastCombined.band ||
    latest.section !== lastCombined.section
  ) {
    fail(`latest не совпадает с combined[последняя]: ${JSON.stringify(latest)} vs ${JSON.stringify(lastCombined)}`);
  }

  // 10. exam — в рамке, rightEdge согласован с порогом.
  if (exam) {
    if (!(exam.x >= padL - EPS && exam.x <= w - padR + EPS)) fail(`exam.x=${exam.x} за рамкой`);
    const expectedRightEdge = exam.x > w - padR - 28;
    if (exam.rightEdge !== expectedRightEdge) fail(`exam.rightEdge=${exam.rightEdge}, ожидалось ${expectedRightEdge}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Именованные регресс-фикстуры                                               */
/* -------------------------------------------------------------------------- */

// Общая для фикстур 1 и 8 — плоская серия одного band, окно строго [1.5, 4.0].
const FLAT_BAND_ATTEMPTS: TrajectoryAttempt[] = [
  attempt(2.0, "reading", NOW_MS - 10 * DAY_MS),
  attempt(2.0, "listening", NOW_MS - 8 * DAY_MS),
  attempt(2.0, "reading", NOW_MS - 6 * DAY_MS),
  attempt(2.0, "listening", NOW_MS - 4 * DAY_MS),
  attempt(2.0, "reading", NOW_MS - 2 * DAY_MS),
  attempt(2.0, "listening", NOW_MS),
];
const FLAT_BAND_TRAJECTORY = buildTrajectory(FLAT_BAND_ATTEMPTS);

describe("Фикстура 1: плоская серия одного band", () => {
  for (const size of SIZES) {
    it(`инварианты держатся, окно ровно [1.5, 4.0], все маркеры на одном y (${size.w}x${size.h})`, () => {
      const geom = geomFor(FLAT_BAND_TRAJECTORY, INSUFFICIENT_FORECAST, null, null, size);
      assertInvariants(geom, `fixture=flat-band size=${size.w}x${size.h}`);
      const { yMin, yMax } = recoverYWindow(geom);
      expect(yMin).toBeCloseTo(1.5, 5);
      expect(yMax).toBeCloseTo(4.0, 5);
      const ys = geom.combined.map((p) => p.y);
      for (const y of ys) expect(y).toBeCloseTo(ys[0], 5);
    });
  }
});

describe("Фикстура 2: башня (reading 3.5 / listening 2.0 вперемешку)", () => {
  const attempts = Array.from({ length: 8 }, (_, i) =>
    attempt(i % 2 === 0 ? 3.5 : 2.0, i % 2 === 0 ? "reading" : "listening", NOW_MS - (14 - i * 2) * DAY_MS),
  );
  const trajectory = buildTrajectory(attempts);

  for (const size of SIZES) {
    it(`инварианты держатся, обе секции присутствуют (${size.w}x${size.h})`, () => {
      const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, null, null, size);
      assertInvariants(geom, `fixture=tower size=${size.w}x${size.h}`);
      expect(geom.reading).not.toBeNull();
      expect(geom.listening).not.toBeNull();
      expect(geom.combined).toHaveLength(8);
    });
  }
});

describe("Фикстура 3: стековые точки (два мока разных секций 5 минут друг от друга + 3 обычных)", () => {
  const base = NOW_MS - 5 * DAY_MS;
  const attempts = [
    attempt(5.0, "reading", base),
    attempt(4.5, "listening", base + 5 * 60_000),
    attempt(6.0, "reading", NOW_MS - 3 * DAY_MS),
    attempt(5.5, "listening", NOW_MS - 2 * DAY_MS),
    attempt(6.5, "reading", NOW_MS),
  ];
  const trajectory = buildTrajectory(attempts);

  for (const size of SIZES) {
    it(`инварианты держатся, все 5 точек на месте (${size.w}x${size.h})`, () => {
      const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, null, null, size);
      assertInvariants(geom, `fixture=stacked-points size=${size.w}x${size.h}`);
      expect(geom.combined).toHaveLength(5);
    });
  }
});

describe("Фикстура 4: окно короче 2 суток (4 мока в 30 часах)", () => {
  const t0 = NOW_MS - 30 * HOUR_MS;
  const attempts = [
    attempt(5.0, "reading", t0),
    attempt(5.5, "listening", t0 + 8 * HOUR_MS),
    attempt(5.5, "reading", t0 + 20 * HOUR_MS),
    attempt(6.0, "listening", t0 + 30 * HOUR_MS),
  ];
  const trajectory = buildTrajectory(attempts);

  for (const size of SIZES) {
    // Дедуп подписей проверен инвариантом 7 внутри assertInvariants — отдельный
    // хрупкий ассерт «есть хотя бы одна пустая подпись» не добавляем: он верен
    // только если соседние засечки РЕАЛЬНО совпали текстом, что зависит от TZ.
    it(`инварианты держатся на коротком X-окне (${size.w}x${size.h})`, () => {
      const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, null, null, size);
      assertInvariants(geom, `fixture=short-window size=${size.w}x${size.h}`);
    });
  }
});

describe("Фикстура 5: один мок", () => {
  const trajectory = buildTrajectory([attempt(6.5, "reading", NOW_MS)]);

  for (const size of SIZES) {
    it(`line/reading/listening null, combined из одной точки (${size.w}x${size.h})`, () => {
      const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, null, null, size);
      assertInvariants(geom, `fixture=single-mock size=${size.w}x${size.h}`);
      expect(geom.line).toBeNull();
      expect(geom.reading).toBeNull();
      expect(geom.listening).toBeNull();
      expect(geom.combined).toHaveLength(1);
      expect(geom.pointXs).toHaveLength(1);
      expect(geom.latest.band).toBe(6.5);
      expect(geom.latest.x).toBeCloseTo(geom.combined[0].x, 5);
      expect(geom.latest.y).toBeCloseTo(geom.combined[0].y, 5);
    });
  }
});

describe("Фикстура 6: одна секция (только reading)", () => {
  const attempts = [
    attempt(5.0, "reading", NOW_MS - 9 * DAY_MS),
    attempt(5.5, "reading", NOW_MS - 6 * DAY_MS),
    attempt(6.0, "reading", NOW_MS - 3 * DAY_MS),
    attempt(6.5, "reading", NOW_MS),
  ];
  const trajectory = buildTrajectory(attempts);

  for (const size of SIZES) {
    it(`listening null, reading == combined (${size.w}x${size.h})`, () => {
      const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, null, null, size);
      assertInvariants(geom, `fixture=one-section size=${size.w}x${size.h}`);
      expect(geom.listening).toBeNull();
      expect(geom.reading).not.toBeNull();
    });
  }
});

describe("Фикстура 7: target внутри окна", () => {
  const attempts = [
    attempt(4.5, "reading", NOW_MS - 8 * DAY_MS),
    attempt(5.0, "listening", NOW_MS - 6 * DAY_MS),
    attempt(5.5, "reading", NOW_MS - 4 * DAY_MS),
    attempt(5.5, "listening", NOW_MS - 2 * DAY_MS),
    attempt(6.0, "reading", NOW_MS),
  ];
  const trajectory = buildTrajectory(attempts);

  for (const size of SIZES) {
    it(`target non-null, targetEdge null (${size.w}x${size.h})`, () => {
      const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, 5.5, null, size);
      assertInvariants(geom, `fixture=target-in-window size=${size.w}x${size.h}`);
      expect(geom.target).not.toBeNull();
      expect(geom.targetEdge).toBeNull();
    });

    // Данные 4.5–6.0 → окно ровно [4.0, 6.5] (span 2.5, минимум не растягивает).
    // projectedBand=5.75 лежит строго внутри — кламп не должен сработать, никакого
    // бейджа-стрелки рядом с target-линией.
    it(`target в окне + forecast в окне → forecast.clamped=false (${size.w}x${size.h})`, () => {
      const geom = geomFor(trajectory, { status: "ok", projectedBand: 5.75 }, 5.5, null, size);
      assertInvariants(geom, `fixture=target-in-window+forecast-on size=${size.w}x${size.h}`);
      expect(geom.target).not.toBeNull();
      expect(geom.forecast).not.toBeNull();
      expect(geom.forecast!.clamped).toBe(false);
      expect(geom.forecast!.band).toBe(5.75);
    });
  }
});

describe("Фикстура 8: target ровно на границах окна [1.5, 4.0]", () => {
  const cases: { targetBand: number; expected: "line" | "badge-above" | "badge-below" }[] = [
    { targetBand: 4.0, expected: "line" }, // верхняя граница включительно
    { targetBand: 1.5, expected: "line" }, // нижняя граница включительно
    { targetBand: 4.5, expected: "badge-above" },
    { targetBand: 1.0, expected: "badge-below" },
  ];

  for (const c of cases) {
    for (const size of SIZES) {
      it(`target=${c.targetBand} → ${c.expected} (${size.w}x${size.h})`, () => {
        const geom = geomFor(FLAT_BAND_TRAJECTORY, INSUFFICIENT_FORECAST, c.targetBand, null, size);
        assertInvariants(geom, `fixture=target-boundary target=${c.targetBand} size=${size.w}x${size.h}`);
        if (c.expected === "line") {
          expect(geom.target).not.toBeNull();
          expect(geom.targetEdge).toBeNull();
        } else {
          expect(geom.target).toBeNull();
          expect(geom.targetEdge).not.toBeNull();
          expect(geom.targetEdge?.above).toBe(c.expected === "badge-above");
        }
      });
    }
  }
});

describe("Фикстура 9: target далеко выше окна", () => {
  const attempts = [
    attempt(2.0, "reading", NOW_MS - 6 * DAY_MS),
    attempt(2.5, "listening", NOW_MS - 4 * DAY_MS),
    attempt(2.5, "reading", NOW_MS - 2 * DAY_MS),
    attempt(3.0, "listening", NOW_MS),
  ];
  const trajectory = buildTrajectory(attempts);

  for (const size of SIZES) {
    it(`бейдж, above=true (${size.w}x${size.h})`, () => {
      const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, 8.5, null, size);
      assertInvariants(geom, `fixture=target-far-above size=${size.w}x${size.h}`);
      expect(geom.target).toBeNull();
      expect(geom.targetEdge).not.toBeNull();
      expect(geom.targetEdge?.above).toBe(true);
    });
  }
});

describe("Фикстура 10: target не задан", () => {
  const attempts = [
    attempt(5.0, "reading", NOW_MS - 6 * DAY_MS),
    attempt(5.5, "listening", NOW_MS - 3 * DAY_MS),
    attempt(6.0, "reading", NOW_MS),
  ];
  const trajectory = buildTrajectory(attempts);

  for (const size of SIZES) {
    it(`target и targetEdge оба null (${size.w}x${size.h})`, () => {
      const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, null, null, size);
      assertInvariants(geom, `fixture=no-target size=${size.w}x${size.h}`);
      expect(geom.target).toBeNull();
      expect(geom.targetEdge).toBeNull();
    });
  }
});

describe("Фикстура 11: экзамен в окне", () => {
  // Размах данных ровно 10 дней (firstT..lastT); rightPad = max(10d*0.18, 0.5d) =
  // 1.8d → xMax = lastT + 1.8d = 2026-07-16T07:12Z. examDate 2026-07-16 (00:00Z)
  // попадает и в окно (≤ xMax), и в будущее относительно nowMs (12:00 предыдущего дня).
  const firstT = NOW_MS - 11 * DAY_MS;
  const lastT = NOW_MS - 1 * DAY_MS;
  const attempts = [
    attempt(5.0, "reading", firstT),
    attempt(5.5, "listening", NOW_MS - 6 * DAY_MS),
    attempt(6.0, "reading", lastT),
  ];
  const trajectory = buildTrajectory(attempts);
  const examDate = "2026-07-16";

  for (const size of SIZES) {
    it(`exam non-null (${size.w}x${size.h})`, () => {
      const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, null, examDate, size);
      assertInvariants(geom, `fixture=exam-in-window size=${size.w}x${size.h}`);
      expect(geom.exam).not.toBeNull();
    });
  }
});

describe("Фикстура 12: совпадающие таймстампы (3 мока в один момент)", () => {
  const t = NOW_MS - 3 * DAY_MS;
  const attempts = [attempt(5.0, "reading", t), attempt(5.5, "listening", t), attempt(6.0, "reading", t)];
  const trajectory = buildTrajectory(attempts);

  for (const size of SIZES) {
    it(`инварианты держатся, pointXs схлопнут в одну колонку (${size.w}x${size.h})`, () => {
      const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, null, null, size);
      assertInvariants(geom, `fixture=same-timestamp size=${size.w}x${size.h}`);
      expect(geom.combined).toHaveLength(3);
      expect(geom.pointXs).toHaveLength(1);
    });
  }
});

describe("Фикстура 13: band 1.0 у пола и 9.0 у потолка", () => {
  const attempts = [
    attempt(1.0, "reading", NOW_MS - 6 * DAY_MS),
    attempt(9.0, "listening", NOW_MS - 3 * DAY_MS),
    attempt(5.0, "reading", NOW_MS),
  ];
  const trajectory = buildTrajectory(attempts);

  for (const size of SIZES) {
    it(`окно ровно [1, 9], маркеры на кромках плота (${size.w}x${size.h})`, () => {
      const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, null, null, size);
      assertInvariants(geom, `fixture=floor-ceiling size=${size.w}x${size.h}`);
      const { yMin, yMax } = recoverYWindow(geom);
      expect(yMin).toBeCloseTo(1, 5);
      expect(yMax).toBeCloseTo(9, 5);
      const floorPoint = geom.combined.find((p) => p.band === 1.0)!;
      const ceilPoint = geom.combined.find((p) => p.band === 9.0)!;
      expect(floorPoint.y).toBeCloseTo(geom.h - geom.padB, 5); // band минимум → низ плота
      expect(ceilPoint.y).toBeCloseTo(geom.padT, 5); // band максимум → верх плота
    });
  }
});

describe("Фикстура 14: 100 точек (кап запроса), band из детерминированного PRNG", () => {
  const FIXTURE_100_SEED = 100;
  const rand = mulberry32(FIXTURE_100_SEED);
  const attempts = Array.from({ length: 100 }, () => {
    const t = NOW_MS - Math.floor(rand() * 60) * DAY_MS - Math.floor(rand() * DAY_MS);
    const band = 1 + 0.5 * Math.floor(rand() * 17);
    const section: "reading" | "listening" = rand() < 0.5 ? "reading" : "listening";
    return attempt(band, section, t);
  });
  const trajectory = buildTrajectory(attempts);

  for (const size of SIZES) {
    it(`инварианты держатся на 100 точках (${size.w}x${size.h})`, () => {
      const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, null, null, size);
      assertInvariants(geom, `fixture=hundred-points size=${size.w}x${size.h}`);
      expect(geom.combined).toHaveLength(100);
    });
  }
});

describe("Фикстура 15: forecast-стаб вне Y-окна (упражняет кламп projY к кромке плота)", () => {
  // Инвариант 6 в assertInvariants проверяется ТОЛЬКО когда forecast non-null, а
  // все именованные фикстуры выше используют INSUFFICIENT_FORECAST (forecast=null)
  // — реальный кламп projY exercised только вероятностно через seeded-свип. Этой
  // фикстурой мы гарантируем детерминированное покрытие в обе стороны (проекция
  // выше/ниже окна), не полагаясь на удачу PRNG свипа.

  // Above: данные 1.0–2.0 → окно ровно [1.0, 3.5]; projectedBand=4.0 (выше yMax).
  const aboveAttempts = [
    attempt(1.0, "reading", NOW_MS - 6 * DAY_MS),
    attempt(1.5, "listening", NOW_MS - 3 * DAY_MS),
    attempt(2.0, "reading", NOW_MS),
  ];
  const aboveTrajectory = buildTrajectory(aboveAttempts);

  // Below: данные 6.5–7.5 → окно ровно [6.0, 8.5]; projectedBand=5.0 (ниже yMin).
  const belowAttempts = [
    attempt(6.5, "reading", NOW_MS - 6 * DAY_MS),
    attempt(7.0, "listening", NOW_MS - 3 * DAY_MS),
    attempt(7.5, "reading", NOW_MS),
  ];
  const belowTrajectory = buildTrajectory(belowAttempts);

  for (const size of SIZES) {
    it(`projectedBand выше окна клампится к верхней кромке, clamped=true, band сохранён (${size.w}x${size.h})`, () => {
      const geom = geomFor(aboveTrajectory, { status: "ok", projectedBand: 4.0 }, null, null, size);
      assertInvariants(geom, `fixture=forecast-above-window size=${size.w}x${size.h}`);
      expect(geom.forecast).not.toBeNull();
      expect(geom.forecast!.projY).toBeCloseTo(geom.padT, 5);
      expect(geom.forecast!.clamped).toBe(true);
      expect(geom.forecast!.band).toBe(4.0);
    });

    it(`projectedBand ниже окна клампится к нижней кромке, clamped=true, band сохранён (${size.w}x${size.h})`, () => {
      const geom = geomFor(belowTrajectory, { status: "ok", projectedBand: 5.0 }, null, null, size);
      assertInvariants(geom, `fixture=forecast-below-window size=${size.w}x${size.h}`);
      expect(geom.forecast).not.toBeNull();
      expect(geom.forecast!.projY).toBeCloseTo(geom.h - geom.padB, 5);
      expect(geom.forecast!.clamped).toBe(true);
      expect(geom.forecast!.band).toBe(5.0);
    });
  }
});

describe("Контракт пустого входа", () => {
  it("buildChartGeometry бросает на пустой trajectory.combined", () => {
    const emptyTrajectory = buildTrajectory([]);
    expect(() =>
      buildChartGeometry(
        { trajectory: emptyTrajectory, forecast: INSUFFICIENT_FORECAST, targetBand: null, examDate: null, nowMs: NOW_MS },
        CHART_DESKTOP,
      ),
    ).toThrow();
  });
});

describe("dedupeConsecutiveLabels", () => {
  it("гасит подряд идущий повтор до пустой строки", () => {
    expect(dedupeConsecutiveLabels(["A", "A", "B"])).toEqual(["A", "", "B"]);
  });

  it("гасит ВСЕ подряд идущие повторы одной подписи", () => {
    expect(dedupeConsecutiveLabels(["A", "A", "A"])).toEqual(["A", "", ""]);
  });

  it("не трогает неповторяющиеся подряд подписи (A,B,A — не глобальный дедуп)", () => {
    expect(dedupeConsecutiveLabels(["A", "B", "A"])).toEqual(["A", "B", "A"]);
  });

  it("пустой массив → пустой массив", () => {
    expect(dedupeConsecutiveLabels([])).toEqual([]);
  });

  it("один элемент — без изменений", () => {
    expect(dedupeConsecutiveLabels(["A"])).toEqual(["A"]);
  });

  it("[A,\"\",A] — старая семантика: пустая подпись обновляет prevLabel, поэтому " +
    "второй A НЕ гасится (prevLabel после i=1 становится \"\", а \"A\" ей не равна)", () => {
    expect(dedupeConsecutiveLabels(["A", "", "A"])).toEqual(["A", "", "A"]);
  });
});

/**
 * Регресс-пин замороженного X-домена (решение владельца, не подлежит вкусовщине).
 * Коэффициенты 0.06/0.18 + полы 0.25d/0.5d + ветка span=0 → ±3d СОЗНАТЕЛЬНО
 * продублированы здесь как заморозка ожидаемого поведения: без независимой копии
 * формулы инварианты «маркеры в плоте»/«ticks равномерны» проходят при ЛЮБЫХ
 * коэффициентах xMin/xMax (сдвиг всего домена целиком их не ломает) — эта проверка
 * единственная, что ловит случайный дрейф самих коэффициентов.
 */
describe("Регресс-пин замороженного X-домена", () => {
  // Дублирует xMin/xMax из buildChartGeometry строка-в-строку — намеренный пин, а
  // не переиспользование (тест обязан упасть, если формула в модуле изменится).
  function expectedXWindow(firstT: number, lastT: number): { xMin: number; xMax: number } {
    const span = lastT - firstT;
    const leftPad = span > 0 ? Math.max(span * 0.06, 0.25 * DAY_MS) : 3 * DAY_MS;
    const rightPad = span > 0 ? Math.max(span * 0.18, 0.5 * DAY_MS) : 3 * DAY_MS;
    return { xMin: firstT - leftPad, xMax: lastT + rightPad };
  }

  // recoverXWindow (обратное решение линейной xScale) — на уровне модуля, переиспользуется
  // и assertInvariants (инвариант xTicks.tMs), см. выше.
  const X_TOL = 0.01;

  describe("(а) размах ~10 дней — выигрывают доли 0.06/0.18", () => {
    const firstT = NOW_MS - 10 * DAY_MS;
    const lastT = NOW_MS;
    const trajectory = buildTrajectory([
      attempt(5.0, "reading", firstT),
      attempt(5.5, "listening", NOW_MS - 5 * DAY_MS),
      attempt(6.0, "reading", lastT),
    ]);

    for (const size of SIZES) {
      it(`xMin/xMax восстанавливаются точно по формуле (${size.w}x${size.h})`, () => {
        const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, null, null, size);
        const p1 = geom.combined[0];
        const p2 = geom.combined[geom.combined.length - 1];
        expect(p1.dateMs).toBe(firstT);
        expect(p2.dateMs).toBe(lastT);
        const recovered = recoverXWindow({ t: p1.dateMs, x: p1.x }, { t: p2.dateMs, x: p2.x }, geom);
        const expected = expectedXWindow(firstT, lastT);
        expect(Math.abs(recovered.xMin - expected.xMin)).toBeLessThanOrEqual(T_TOL_MS);
        expect(Math.abs(recovered.xMax - expected.xMax)).toBeLessThanOrEqual(T_TOL_MS);
      });
    }
  });

  describe("(б) размах 1 час — выигрывают полы 0.25d/0.5d", () => {
    const firstT = NOW_MS - HOUR_MS;
    const lastT = NOW_MS;
    const trajectory = buildTrajectory([attempt(5.0, "reading", firstT), attempt(6.0, "listening", lastT)]);

    for (const size of SIZES) {
      it(`xMin/xMax восстанавливаются точно по формуле (${size.w}x${size.h})`, () => {
        const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, null, null, size);
        const p1 = geom.combined[0];
        const p2 = geom.combined[geom.combined.length - 1];
        const recovered = recoverXWindow({ t: p1.dateMs, x: p1.x }, { t: p2.dateMs, x: p2.x }, geom);
        const expected = expectedXWindow(firstT, lastT);
        expect(Math.abs(recovered.xMin - expected.xMin)).toBeLessThanOrEqual(T_TOL_MS);
        expect(Math.abs(recovered.xMax - expected.xMax)).toBeLessThanOrEqual(T_TOL_MS);
      });
    }
  });

  describe("(в) span=0 (все таймстампы равны) — ветка ±3 дня", () => {
    // Одна x-колонна — по двум точкам k не посчитать (t2−t1=0). xMin=t−3d,
    // xMax=t+3d → t строго в середине домена → x строго в середине плота.
    const t = NOW_MS - 3 * DAY_MS;
    const trajectory = buildTrajectory([attempt(5.0, "reading", t), attempt(5.5, "listening", t), attempt(6.0, "reading", t)]);

    for (const size of SIZES) {
      it(`единственная x-колонна ровно в середине плота (${size.w}x${size.h})`, () => {
        const geom = geomFor(trajectory, INSUFFICIENT_FORECAST, null, null, size);
        const PW = geom.w - geom.padL - geom.padR;
        const expectedX = geom.padL + PW / 2;
        expect(geom.pointXs).toHaveLength(1);
        expect(Math.abs(geom.pointXs[0] - expectedX)).toBeLessThanOrEqual(X_TOL);
        expect(Math.abs(geom.combined[0].x - expectedX)).toBeLessThanOrEqual(X_TOL);
      });
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Seeded-свип: ~500 случайных историй, зеркалит панель (buildTrajectory →     */
/* computeForecast → buildChartGeometry), оба размера холста.                  */
/* -------------------------------------------------------------------------- */

const SWEEP_SEED = 1337;
const SWEEP_HISTORIES = 500;

describe("Seeded-свип", () => {
  it(`держит все инварианты на ${SWEEP_HISTORIES} случайных историях × 2 размера (seed=${SWEEP_SEED})`, () => {
    const rand = mulberry32(SWEEP_SEED);
    const bandStep = () => 1 + 0.5 * Math.floor(rand() * 17); // 1.0..9.0 шаг 0.5

    for (let i = 0; i < SWEEP_HISTORIES; i++) {
      const n = 1 + Math.floor(rand() * 100); // 1..100 моков
      const attempts: TrajectoryAttempt[] = [];
      let prevT: number | null = null;
      let maxT = -Infinity;

      for (let j = 0; j < n; j++) {
        const r = rand();
        let t: number;
        if (prevT != null && r < 0.1) {
          t = prevT; // ~10% — точный дубль таймстампа
        } else if (prevT != null && r < 0.3) {
          t = prevT + (1 + Math.floor(rand() * 30)) * 60_000; // ~20% — +1..30 минут
        } else {
          t = NOW_MS - Math.floor(rand() * 90) * DAY_MS - Math.floor(rand() * DAY_MS); // в пределах 90 дней
        }
        const section: "reading" | "listening" = rand() < 0.5 ? "reading" : "listening";
        attempts.push(attempt(bandStep(), section, t));
        prevT = t;
        if (t > maxT) maxT = t;
      }

      const targetBand = rand() < 0.3 ? null : bandStep();

      const re = rand();
      let examDate: string | null;
      if (re < 0.4) {
        examDate = null;
      } else if (re < 0.6) {
        examDate = toIsoDateUTC(NOW_MS - (1 + Math.floor(rand() * 90)) * DAY_MS); // прошлое
      } else if (re < 0.8) {
        examDate = toIsoDateUTC(maxT + Math.floor(rand() * 3 * DAY_MS)); // ≤3 дня от последнего мока
      } else {
        examDate = toIsoDateUTC(NOW_MS + 60 * DAY_MS); // далёкое будущее
      }

      const traj = buildTrajectory(attempts);
      const fc = computeForecast(traj.combined.slice(-20), examDate, targetBand, new Date(NOW_MS));

      for (const size of SIZES) {
        const geom = buildChartGeometry({ trajectory: traj, forecast: fc, targetBand, examDate, nowMs: NOW_MS }, size);
        assertInvariants(geom, `seed=${SWEEP_SEED} history=${i} size=${size.w}x${size.h}`);
      }
    }
  });
});
