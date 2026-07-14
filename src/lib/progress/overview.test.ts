// Юнит-тесты чистого ядра вкладки Overview (buildTrajectory / computeForecast /
// buildReadiness). Всё чистое — без БД/env, поэтому (в отличие от band-plan.test)
// мок @/db не нужен: overview.ts ничего из app-графа не импортирует.
import { describe, it, expect } from "vitest";
import {
  buildTrajectory,
  computeForecast,
  buildReadiness,
  type TrajectoryAttempt,
  type ForecastPoint,
} from "./overview";

/** База времени для детерминированных дат. */
const BASE = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00Z
const day = (n: number) => BASE + n * 86_400_000;

/* -------------------------------------------------------------------------- */
/* buildTrajectory                                                             */
/* -------------------------------------------------------------------------- */

describe("buildTrajectory", () => {
  it("пустой вход → пустые серии", () => {
    expect(buildTrajectory([])).toEqual({ combined: [], reading: [], listening: [] });
  });

  it("отбрасывает попытки без band (не-Full тесты)", () => {
    const attempts: TrajectoryAttempt[] = [
      { bandScore: null, section: "reading", submittedAt: new Date(day(1)) },
      { bandScore: 6.5, section: "reading", submittedAt: new Date(day(2)) },
    ];
    const tr = buildTrajectory(attempts);
    expect(tr.combined).toHaveLength(1);
    expect(tr.combined[0].band).toBe(6.5);
  });

  it("отбрасывает попытки без submittedAt (нечего ставить на ось времени)", () => {
    const attempts: TrajectoryAttempt[] = [
      { bandScore: 6, section: "reading", submittedAt: null },
      { bandScore: 7, section: "reading", submittedAt: new Date(day(2)) },
    ];
    expect(buildTrajectory(attempts).combined).toHaveLength(1);
  });

  it("сортирует по возрастанию времени (линия слева→направо), даже если вход desc", () => {
    const attempts: TrajectoryAttempt[] = [
      { bandScore: 7, section: "reading", submittedAt: new Date(day(30)) },
      { bandScore: 6, section: "reading", submittedAt: new Date(day(10)) },
      { bandScore: 6.5, section: "reading", submittedAt: new Date(day(20)) },
    ];
    const bands = buildTrajectory(attempts).combined.map((p) => p.band);
    expect(bands).toEqual([6, 6.5, 7]);
  });

  it("сплитит combined на reading/listening", () => {
    const attempts: TrajectoryAttempt[] = [
      { bandScore: 6, section: "reading", submittedAt: new Date(day(1)) },
      { bandScore: 5.5, section: "listening", submittedAt: new Date(day(2)) },
      { bandScore: 6.5, section: "reading", submittedAt: new Date(day(3)) },
    ];
    const tr = buildTrajectory(attempts);
    expect(tr.combined).toHaveLength(3);
    expect(tr.reading.map((p) => p.band)).toEqual([6, 6.5]);
    expect(tr.listening.map((p) => p.band)).toEqual([5.5]);
  });

  it("принимает ISO-строку submittedAt наравне с Date", () => {
    const tr = buildTrajectory([
      { bandScore: 6, section: "reading", submittedAt: new Date(day(1)).toISOString() },
    ]);
    expect(tr.combined[0].t).toBe(day(1));
  });

  it("детерминизм: одинаковый вход → идентичный выход", () => {
    const attempts: TrajectoryAttempt[] = [
      { bandScore: 6, section: "reading", submittedAt: new Date(day(1)) },
      { bandScore: 7, section: "listening", submittedAt: new Date(day(2)) },
    ];
    expect(buildTrajectory(attempts)).toEqual(buildTrajectory(attempts));
  });
});

/* -------------------------------------------------------------------------- */
/* computeForecast                                                             */
/* -------------------------------------------------------------------------- */

/** Линейно растущая серия band=5.0..7.0 на днях 0,10,20,30,40 (наклон 0.05/день). */
const RISING: ForecastPoint[] = [
  { t: day(0), band: 5.0 },
  { t: day(10), band: 5.5 },
  { t: day(20), band: 6.0 },
  { t: day(30), band: 6.5 },
  { t: day(40), band: 7.0 },
];
const NOW_AT_LAST = new Date(day(40)); // «сейчас» = день последней попытки

describe("computeForecast — пороги данных", () => {
  it("<3 точек → insufficient, без числа и коридора", () => {
    const f = computeForecast(RISING.slice(0, 2), "2026-03-01", 7, NOW_AT_LAST);
    expect(f.status).toBe("insufficient");
    expect(f.projectedBand).toBeNull();
    expect(f.interval).toBeNull();
    expect(f.verdict).toBe("insufficient");
    expect(f.slopePerWeek).toBeNull();
    expect(f.horizonDate).toBeNull();
  });

  it("3–4 точки → low_confidence, коридор есть", () => {
    const f = computeForecast(RISING.slice(0, 3), "2026-03-01", 7, NOW_AT_LAST);
    expect(f.status).toBe("low_confidence");
    expect(f.projectedBand).not.toBeNull();
    expect(f.interval).not.toBeNull();
  });

  it("≥5 точек → ok", () => {
    const f = computeForecast(RISING, "2026-03-01", 7, NOW_AT_LAST);
    expect(f.status).toBe("ok");
    expect(f.pointCount).toBe(5);
  });

  it("low_confidence шире либо равно ok на тех же остатках (t(df) при меньшем n)", () => {
    // Серия с ненулевым разбросом остатков, чтобы коридор зависел от sePred.
    // Меньше точек → больше t(df) и больше SE → интервал не уже, чем у ok. Явного ×1.5 нет.
    const noisy: ForecastPoint[] = [
      { t: day(0), band: 5.0 },
      { t: day(10), band: 6.0 },
      { t: day(20), band: 5.5 },
      { t: day(30), band: 6.5 },
      { t: day(40), band: 6.0 },
    ];
    const okF = computeForecast(noisy, "2026-03-01", 7, NOW_AT_LAST);
    const lowF = computeForecast(noisy.slice(0, 4), "2026-03-01", 7, NOW_AT_LAST);
    const okWidth = okF.interval!.high - okF.interval!.low;
    const lowWidth = lowF.interval!.high - lowF.interval!.low;
    expect(lowWidth).toBeGreaterThanOrEqual(okWidth);
  });

  // Аналитически посчитанные границы коридора (t-квантиль захардкожен, арифметика точна).
  it("OLS: коридор совпадает с ручным расчётом t(df)·SE (округл. к 0.5)", () => {
    // noisy на 5 точках: ybar=5.8, slope=0.025, intercept=5.3; x0=59 (2026-03-01).
    // projectedRaw=6.775; ssResid=0.675, df=3, residualStd=√0.225=0.47434;
    // SE=0.47434·√(1+0.2+39²/1000)=0.47434·√2.721=0.78246; t(3)=1.638 → hw=1.28167.
    // low=round½(5.4933)=5.5, high=round½(8.0567)=8.0.
    const noisy: ForecastPoint[] = [
      { t: day(0), band: 5.0 },
      { t: day(10), band: 6.0 },
      { t: day(20), band: 5.5 },
      { t: day(30), band: 6.5 },
      { t: day(40), band: 6.0 },
    ];
    const f = computeForecast(noisy, "2026-03-01", 7, NOW_AT_LAST);
    expect(f.status).toBe("ok");
    expect(f.interval).toEqual({ low: 5.5, high: 8.0 });
  });

  it("intercept-only: коридор из t(n−1)·SE на вырожденном входе (округл. к 0.5)", () => {
    // 4 попытки в один день, bands [6,6,6,8]: ybar=6.5, ssResid=3.0, df=3,
    // residualStd=1.0, SE=√(1+1/4)=1.11803; t(3)=1.638 → hw=1.83134.
    // projectedRaw=6.5 → low=round½(4.6687)=4.5, high=round½(8.3313)=8.5.
    const oneDay: ForecastPoint[] = [6, 6, 6, 8].map((b) => ({ t: day(10), band: b }));
    const f = computeForecast(oneDay, "2026-03-01", 7, NOW_AT_LAST);
    expect(f.status).toBe("low_confidence");
    expect(f.interval).toEqual({ low: 4.5, high: 8.5 });
  });
});

describe("computeForecast — проекция, кламп, округление", () => {
  it("проецирует по наклону на день экзамена (идеально линейная история)", () => {
    // examDate = день 60 → 5.0 + 0.05*60 = 8.0.
    const f = computeForecast(RISING, "2026-03-02", 7, NOW_AT_LAST); // 2026-03-02 = day(60)
    expect(f.horizonSource).toBe("exam_date");
    expect(f.horizonDate).toBe("2026-03-02");
    expect(f.projectedBand).toBe(8.0);
    // Идеальный фит → остатки 0 → пол коридора ±0.5.
    expect(f.interval).toEqual({ low: 7.5, high: 8.5 });
  });

  it("клампит проекцию сверху к 9.0", () => {
    // day 200 → 5.0 + 0.05*200 = 15 → clamp 9.0.
    const f = computeForecast(RISING, "2026-07-20", 7, NOW_AT_LAST); // day(200)
    expect(f.projectedBand).toBe(9.0);
    expect(f.interval!.high).toBe(9.0);
  });

  it("клампит проекцию снизу к 4.0 на нисходящей серии", () => {
    const falling: ForecastPoint[] = RISING.map((p, i) => ({ t: p.t, band: 7.0 - i * 0.5 }));
    // intercept 7.0, наклон −0.05; day 80 → 7.0 − 4.0 = 3.0 → clamp 4.0.
    const f = computeForecast(falling, "2026-03-22", 5, NOW_AT_LAST); // day(80)
    expect(f.projectedBand).toBe(4.0);
    expect(f.interval!.low).toBe(4.0);
    expect(f.trend).toBe("down");
  });

  it("округляет проекцию к 0.5-шагу IELTS", () => {
    // Наклон 0.06/день на серии 5.0,5.6,6.2,6.8,7.4; day 45 → 5.0+0.06*45=7.7 → 7.5.
    const pts: ForecastPoint[] = [0, 10, 20, 30, 40].map((d, i) => ({
      t: day(d),
      band: 5.0 + i * 0.6,
    }));
    const f = computeForecast(pts, "2026-02-15", 7, NOW_AT_LAST); // day(45)
    expect(f.projectedBand! % 0.5).toBe(0);
    expect(f.projectedBand).toBe(7.5);
  });
});

describe("computeForecast — тренд", () => {
  it("восходящий → up", () => {
    expect(computeForecast(RISING, "2026-03-01", 7, NOW_AT_LAST).trend).toBe("up");
  });

  it("нисходящий → down", () => {
    const falling: ForecastPoint[] = RISING.map((p, i) => ({ t: p.t, band: 7.0 - i * 0.5 }));
    expect(computeForecast(falling, "2026-03-01", 5, NOW_AT_LAST).trend).toBe("down");
  });

  it("плоский (наклон под порогом) → flat", () => {
    const flat: ForecastPoint[] = [0, 10, 20, 30, 40].map((d) => ({ t: day(d), band: 6.0 }));
    const f = computeForecast(flat, "2026-03-01", 7, NOW_AT_LAST);
    expect(f.trend).toBe("flat");
    expect(f.slopePerWeek).toBe(0);
  });
});

describe("computeForecast — вердикт", () => {
  it("target достигнут фактическим последним band → reached (даже если проекция выше)", () => {
    const f = computeForecast(RISING, "2026-03-01", 6.5, NOW_AT_LAST); // latest=7.0 ≥ 6.5
    expect(f.verdict).toBe("reached");
  });

  it("проекция дотягивает до target → on_track", () => {
    const f = computeForecast(RISING, "2026-03-02", 7.5, NOW_AT_LAST); // projected 8.0 ≥ 7.5, latest 7.0 < 7.5
    expect(f.verdict).toBe("on_track");
  });

  it("проекция не дотягивает → behind", () => {
    const f = computeForecast(RISING, "2026-03-02", 8.5, NOW_AT_LAST); // projected 8.0 < 8.5
    expect(f.verdict).toBe("behind");
  });

  it("нет target → no_target", () => {
    expect(computeForecast(RISING, "2026-03-01", null, NOW_AT_LAST).verdict).toBe("no_target");
  });
});

describe("computeForecast — горизонт без exam_date", () => {
  it("нет exam_date → прогноз на +30 дней от now, horizonSource=default_30d", () => {
    const f = computeForecast(RISING, null, 7, NOW_AT_LAST);
    expect(f.horizonSource).toBe("default_30d");
    expect(f.horizonDate).toBe("2026-03-12"); // day(40)+30 = day(70)
  });

  it("exam_date в прошлом → падает на default_30d (проекция в прошлое бессмысленна)", () => {
    const f = computeForecast(RISING, "2025-06-01", 7, NOW_AT_LAST);
    expect(f.horizonSource).toBe("default_30d");
  });

  it("битая строка exam_date → default_30d", () => {
    const f = computeForecast(RISING, "not-a-date", 7, NOW_AT_LAST);
    expect(f.horizonSource).toBe("default_30d");
  });
});

describe("computeForecast — вырожденные входы", () => {
  it("пустой вход → insufficient, latestBand=null", () => {
    const f = computeForecast([], "2026-03-01", 7, NOW_AT_LAST);
    expect(f.status).toBe("insufficient");
    expect(f.latestBand).toBeNull();
  });

  it("все попытки в один день → наклон 0, статус low_confidence, коридор конечен", () => {
    const sameDay: ForecastPoint[] = [6.0, 6.5, 6.0, 6.5, 6.0].map((b) => ({ t: day(10), band: b }));
    const f = computeForecast(sameDay, "2026-03-01", 7, NOW_AT_LAST);
    expect(f.slopePerWeek).toBe(0);
    expect(f.trend).toBe("flat");
    expect(f.interval).not.toBeNull();
    expect(f.projectedBand).toBe(6.0); // среднее ≈6.2 → округление к 0.5 = 6.0
    // n=5, но нет разброса времени → статус НЕ поднимается до 'ok' (finding 1).
    expect(f.status).toBe("low_confidence");
    // Никаких NaN/Infinity на вырожденном входе.
    expect(Number.isFinite(f.projectedBand!)).toBe(true);
    expect(Number.isFinite(f.interval!.low)).toBe(true);
    expect(Number.isFinite(f.interval!.high)).toBe(true);
    expect(Number.isFinite(f.slopePerWeek!)).toBe(true);
  });

  it("две точки в один день → insufficient, без NaN (числа либо конечны, либо null)", () => {
    const twoSameDay: ForecastPoint[] = [6.0, 7.0].map((b) => ({ t: day(10), band: b }));
    const f = computeForecast(twoSameDay, "2026-03-01", 7, NOW_AT_LAST);
    expect(f.status).toBe("insufficient");
    expect(f.projectedBand).toBeNull();
    expect(f.interval).toBeNull();
    expect(f.slopePerWeek).toBeNull();
    expect(Number.isFinite(f.latestBand!)).toBe(true); // 7.0, не NaN
  });

  it("все band одинаковы (плоско, разброс по времени есть) → конечный коридор, slope 0", () => {
    const sameBand: ForecastPoint[] = [0, 10, 20, 30, 40].map((d) => ({ t: day(d), band: 6.0 }));
    const f = computeForecast(sameBand, "2026-03-01", 7, NOW_AT_LAST);
    expect(f.status).toBe("ok"); // разброс по времени есть → не вырожден
    expect(f.slopePerWeek).toBe(0);
    expect(Number.isFinite(f.projectedBand!)).toBe(true);
    expect(f.interval).toEqual({ low: 5.5, high: 6.5 }); // идеальный фит → пол ±0.5
  });

  it("вход в произвольном порядке → latestBand по хронологии, не по позиции", () => {
    const shuffled = [RISING[2], RISING[4], RISING[0], RISING[3], RISING[1]];
    const f = computeForecast(shuffled, "2026-03-01", 7, NOW_AT_LAST);
    expect(f.latestBand).toBe(7.0);
  });

  it("детерминизм", () => {
    const a = computeForecast(RISING, "2026-03-01", 7, NOW_AT_LAST);
    const b = computeForecast(RISING, "2026-03-01", 7, NOW_AT_LAST);
    expect(a).toEqual(b);
  });
});

describe("computeForecast — граница по числу точек n=0..5", () => {
  // Параметризация вокруг порогов MIN_POINTS_FORECAST=3 и MIN_POINTS_OK=5.
  // RISING разнесён по 40 дням → не вырожден, так что n=5 честно даёт 'ok'.
  const cases: Array<{
    n: number;
    status: "insufficient" | "low_confidence" | "ok";
    hasBand: boolean;
  }> = [
    { n: 0, status: "insufficient", hasBand: false },
    { n: 1, status: "insufficient", hasBand: false },
    { n: 2, status: "insufficient", hasBand: false },
    { n: 3, status: "low_confidence", hasBand: true },
    { n: 4, status: "low_confidence", hasBand: true },
    { n: 5, status: "ok", hasBand: true },
  ];

  for (const c of cases) {
    it(`n=${c.n} → status ${c.status}, projectedBand ${c.hasBand ? "есть" : "null"}`, () => {
      const f = computeForecast(RISING.slice(0, c.n), "2026-03-01", 7, NOW_AT_LAST);
      expect(f.status).toBe(c.status);
      expect(f.pointCount).toBe(c.n);
      if (c.hasBand) {
        expect(f.projectedBand).not.toBeNull();
        expect(Number.isFinite(f.projectedBand!)).toBe(true);
        expect(Number.isFinite(f.interval!.low)).toBe(true);
        expect(Number.isFinite(f.interval!.high)).toBe(true);
        expect(Number.isFinite(f.slopePerWeek!)).toBe(true);
      } else {
        expect(f.projectedBand).toBeNull();
        expect(f.interval).toBeNull();
        expect(f.slopePerWeek).toBeNull();
      }
    });
  }
});

/* -------------------------------------------------------------------------- */
/* buildReadiness                                                              */
/* -------------------------------------------------------------------------- */

describe("buildReadiness", () => {
  it("все 4 скилла заданы → overall = среднее, округлённое к 0.5", () => {
    const r = buildReadiness({ reading: 7, listening: 6, writing: 6.5, speaking: 6, targetBand: 6.5 });
    expect(r.skillsCounted).toBe(4);
    // среднее (7+6+6.5+6)/4 = 6.375 → округл. к 0.5 = 6.5
    expect(r.overallBand).toBe(6.5);
    expect(r.skills.map((s) => s.skill)).toEqual(["reading", "listening", "writing", "speaking"]);
  });

  it("met/gap считаются относительно target", () => {
    const r = buildReadiness({ reading: 7, listening: 6, writing: null, speaking: 5.5, targetBand: 6.5 });
    const reading = r.skills.find((s) => s.skill === "reading")!;
    const listening = r.skills.find((s) => s.skill === "listening")!;
    const speaking = r.skills.find((s) => s.skill === "speaking")!;
    expect(reading.met).toBe(true);
    expect(reading.gap).toBe(-0.5); // с запасом
    expect(listening.met).toBe(false);
    expect(listening.gap).toBe(0.5);
    expect(speaking.gap).toBe(1);
  });

  it("отсутствующий скилл → band=null, met=false, gap=null, не входит в overall", () => {
    const r = buildReadiness({ reading: 7, listening: null, writing: null, speaking: null, targetBand: 6 });
    const listening = r.skills.find((s) => s.skill === "listening")!;
    expect(listening.band).toBeNull();
    expect(listening.met).toBe(false);
    expect(listening.gap).toBeNull();
    expect(r.skillsCounted).toBe(1);
    expect(r.overallBand).toBe(7); // единственный доступный
  });

  it("нет target → met везде false, gap везде null", () => {
    const r = buildReadiness({ reading: 7, listening: 6, writing: 6, speaking: 6, targetBand: null });
    expect(r.skills.every((s) => !s.met && s.gap === null)).toBe(true);
    expect(r.overallBand).toBe(6.5); // overall не зависит от target
  });

  it("пусто → overall=null, counted=0", () => {
    const r = buildReadiness({ reading: null, listening: null, writing: null, speaking: null, targetBand: 6 });
    expect(r.overallBand).toBeNull();
    expect(r.skillsCounted).toBe(0);
  });
});
