// Юнит-тесты чистого ядра вкладки Overview (buildTrajectory / computeForecast /
// buildReadiness). Всё чистое — без БД/env, поэтому (в отличие от band-plan.test)
// мок @/db не нужен: overview.ts ничего из app-графа не импортирует.
import { describe, it, expect } from "vitest";
import {
  buildTrajectory,
  buildOverallSeries,
  computeForecast,
  buildReadiness,
  maxBandGainPerDay,
  maxForecastBandGain,
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
  // Фикстуры подобраны почти-плоскими, чтобы тировый кап был ИНЕРТЕН и тест валидировал
  // именно SE/t(df)-арифметику; связывание капа проверяется отдельным блоком ниже.
  it("OLS: коридор совпадает с ручным расчётом t(df)·SE (кап инертен, округл. к 0.5)", () => {
    // Пилообразная серия slope≈0: ybar=6.2, slope=0, intercept=6.2; x0=59 (2026-03-01).
    // projectedRaw=6.2; ssResid=0.30, df=3, residualStd=√0.10=0.31623;
    // SE=0.31623·√(1+0.2+39²/1000)=0.31623·√2.721=0.52163205; t(3)=1.638 → hw=0.85443330.
    // Кап: lastActual=6.0, tier 0.4/мес, maxGain=0.4/30·19=0.2533 → окно [5.747,6.253] ⊇ 6.2 →
    // инертно. low=round½(6.2−0.85443)=round½(5.3456)=5.5, high=round½(7.0544)=7.0.
    const noisy: ForecastPoint[] = [
      { t: day(0), band: 6.0 },
      { t: day(10), band: 6.5 },
      { t: day(20), band: 6.0 },
      { t: day(30), band: 6.5 },
      { t: day(40), band: 6.0 },
    ];
    const f = computeForecast(noisy, "2026-03-01", 7, NOW_AT_LAST);
    expect(f.status).toBe("ok");
    expect(f.interval).toEqual({ low: 5.5, high: 7.0 });
  });

  it("intercept-only: коридор из t(n−1)·SE на вырожденном входе (кап инертен, округл. к 0.5)", () => {
    // 4 попытки в пределах 3 часов (разброс <1 суток → вырожденный, intercept-only), с
    // УНИКАЛЬНЫМИ временами: band 8 раньше всех, band 6.0 однозначно последняя (lastActual=6.0,
    // репрезентативный, не выброс) — не зависит от порядка равновременных точек.
    // ybar=6.5, ssResid=3.0, df=3, residualStd=1.0, SE=√(1+1/4)=1.11803; t(3)=1.638 → hw=1.83134.
    // projectedRaw=6.5. Кап: lastActual=6.0, tier 0.4/мес, maxGain≈0.65 → окно ≈[5.35,6.65] ⊇
    // 6.5 → инертно. low=round½(4.6687)=4.5, high=round½(8.3313)=8.5.
    const HOUR = 3_600_000;
    const oneDay: ForecastPoint[] = [8, 6, 6, 6].map((b, i) => ({ t: day(10) + i * HOUR, band: b }));
    const f = computeForecast(oneDay, "2026-03-01", 7, NOW_AT_LAST);
    expect(f.status).toBe("low_confidence");
    expect(f.interval).toEqual({ low: 4.5, high: 8.5 });
  });
});

describe("computeForecast — проекция, кламп, округление", () => {
  it("проекцию по наклону ограничивает тировый кап (наклон RISING круче потолка)", () => {
    // examDate = день 60 → projectedRaw = 5.0 + 0.05*60 = 8.0. Наклон RISING 0.05/день
    // (≈1.5 band/мес) круче тира band≥7.0 (1/3 band/мес), поэтому проекция на 20 дней вперёд
    // от последней точки (band 7.0, day40) ограничена: maxGain=(1/3)/30·20=0.2222 →
    // projectedCapped=7.2222, дожатие внутрь окна [6.778,7.222] → gainHigh=floorHalf(7.222)=7.0
    // → projectedBand=7.0 (не 8.0). Идеальный фит → hw=0.5, коридор центрирован на 7.2222:
    // low=round½(6.7222)=6.5, high=round½(7.7222)=7.5.
    const f = computeForecast(RISING, "2026-03-02", 7, NOW_AT_LAST); // 2026-03-02 = day(60)
    expect(f.horizonSource).toBe("exam_date");
    expect(f.horizonDate).toBe("2026-03-02");
    expect(f.projectedBand).toBe(7.0);
    expect(f.interval).toEqual({ low: 6.5, high: 7.5 });
  });

  it("высокий band + дальний горизонт → точка упирается в финальный кламп шкалы 9.0", () => {
    // bands 6.0..8.0 (slope 0.05) дни 0..40; exam day240 (2026-08-29), 200 дней от day40.
    // lastActual=8.0, окно капа доходит до ~10 → projectedCapped упирается в потолок шкалы:
    // clampRoundBand → 9.0. (Тут финальный [4,9]-кламп доминирует, abs-cap невидим — его
    // проявление проверяется отдельным интеграционным тестом с lastActual=6.0 ниже.)
    const rising8: ForecastPoint[] = [0, 10, 20, 30, 40].map((d, i) => ({
      t: day(d),
      band: 6.0 + i * 0.5,
    }));
    const f = computeForecast(rising8, "2026-08-29", 7, NOW_AT_LAST); // day(240)
    expect(f.projectedBand).toBe(9.0);
    expect(f.interval!.high).toBe(9.0);
  });

  it("нисходящая серия: симметричный кап гасит спад, коридор клампится к 4.0", () => {
    const falling: ForecastPoint[] = RISING.map((p, i) => ({ t: p.t, band: 7.0 - i * 0.5 }));
    // intercept 7.0, наклон −0.05; day 80 → projectedRaw = 3.0. lastActual=5.0, tier <5.5 =
    // 0.5/мес, maxGain=0.5/30·40=0.6667 → окно [4.333,5.667]. projectedCapped=4.333 (кап
    // гасит спад до 3.0), дожатие → projectedBand=4.5 (НЕ 4.0). Коридор центрирован на 4.333,
    // hw=0.5: low=round½(3.833)→кламп 4.0, high=round½(4.833)=5.0.
    const f = computeForecast(falling, "2026-03-22", 5, NOW_AT_LAST); // day(80)
    expect(f.projectedBand).toBe(4.5);
    expect(f.interval!.low).toBe(4.0); // нижний кламп прогноза держит коридор
    expect(f.trend).toBe("down"); // тренд от наблюдаемого наклона — не капится
  });

  it("projectedBand всегда на сетке 0.5 (кап + дожатие внутрь + кламп [4,9])", () => {
    // Инвариант округления: при любом сочетании фикстуры/горизонта точка на 0.5-сетке.
    const flat: ForecastPoint[] = [0, 10, 20, 30, 40].map((d) => ({ t: day(d), band: 6.0 }));
    const steepLow: ForecastPoint[] = [0, 5, 10, 15].map((d, i) => ({ t: day(d), band: 2.0 + i }));
    for (const pts of [RISING, flat, steepLow]) {
      for (const exam of ["2026-02-20", "2026-05-01", "2026-12-01"]) {
        const f = computeForecast(pts, exam, 7, NOW_AT_LAST);
        expect(f.projectedBand! % 0.5).toBe(0);
        expect(Number.isFinite(f.projectedBand!)).toBe(true);
      }
    }
  });
});

describe("computeForecast — кап прироста (extrapolation trap)", () => {
  it("тир maxBandGainPerDay: rate падает с ростом band (провенанс ielts.org/Pearson GSE)", () => {
    // Тиры в полосах/МЕСЯЦ /30. Проверяем и границы (5.5, 7.0 — включительно вверх).
    expect(maxBandGainPerDay(3.0)).toBeCloseTo(0.5 / 30, 10); // <5.5 → 0.5/мес
    expect(maxBandGainPerDay(5.4)).toBeCloseTo(0.5 / 30, 10);
    expect(maxBandGainPerDay(5.5)).toBeCloseTo(0.4 / 30, 10); // [5.5,7.0) → 0.4/мес
    expect(maxBandGainPerDay(6.0)).toBeCloseTo(0.4 / 30, 10);
    expect(maxBandGainPerDay(6.9)).toBeCloseTo(0.4 / 30, 10);
    expect(maxBandGainPerDay(7.0)).toBeCloseTo(1 / 3 / 30, 10); // ≥7.0 → 1/3/мес
    expect(maxBandGainPerDay(8.0)).toBeCloseTo(1 / 3 / 30, 10);
    // Монотонно невозрастающий темп по уровню.
    expect(maxBandGainPerDay(3.0)).toBeGreaterThan(maxBandGainPerDay(6.0));
    expect(maxBandGainPerDay(6.0)).toBeGreaterThan(maxBandGainPerDay(8.0));
  });

  it("maxForecastBandGain: тировый темп × дни, зажатый абс-лимитом 2.0", () => {
    expect(maxForecastBandGain(6.0, 300)).toBe(2.0); // 0.4/30·300=4.0 → абс-лимит 2.0
    expect(maxForecastBandGain(3.0, 30)).toBeCloseTo(0.5, 10); // тир <5.5: 0.5/30·30=0.5
    expect(maxForecastBandGain(7.0, 30)).toBeCloseTo(1 / 3, 10); // тир ≥7.0: (1/3)/30·30=1/3
    expect(maxForecastBandGain(6.0, 0)).toBe(0); // горизонт 0 → без прироста
    expect(maxForecastBandGain(6.0, -5)).toBe(0); // отрицательные дни зажаты в 0
  });

  it("off-grid lastActual + короткий горизонт → инверсия окна, band не сдвигается", () => {
    // lastActual=6.4 (off-grid), горизонт 4 дня → maxGain=0.4/30·4=0.0533. Окно капа
    // [6.347,6.453] не содержит НИ ОДНОЙ 0.5-полосы: gainLow=ceilHalf(6.347)=6.5 >
    // gainHigh=floorHalf(6.453)=6.0 — инверсия. Прирост <0.5 непредставим на сетке →
    // честный прогноз = ближайшая полоса roundHalf(6.4)=6.5 (band не сдвинулся), а НЕ
    // продавленный к 6.0 (что дало бы отклонение 0.4 ≫ капа 0.053).
    const offGrid: ForecastPoint[] = [
      { t: day(0), band: 6.2 },
      { t: day(1), band: 6.3 },
      { t: day(2), band: 6.4 },
    ];
    const now = new Date(day(2));
    const f = computeForecast(offGrid, "2026-01-07", 7, now); // day(6) = 4 дня от day(2)
    expect(f.projectedBand).toBe(6.5); // roundHalf(6.4), без продавливания к 6.0
    expect(Number.isFinite(f.projectedBand!)).toBe(true);
    expect(Number.isFinite(f.interval!.low)).toBe(true);
    expect(Number.isFinite(f.interval!.high)).toBe(true);
    expect(Number.isFinite(f.slopePerWeek!)).toBe(true);
  });

  it("крутой ранний тренд + дальний горизонт → проекция ограничена тиром, а не 9.0", () => {
    // Реплика прод-случая: низкие ранние моки, крутой наклон. Дни 0,5,10,15, bands 2→5
    // (наклон 0.2/день). NOW=day15, exam через 75 дней (day90 = 2026-04-01).
    // OLS: intercept=2.0, x0=90 → projectedRaw=2.0+0.2*90=20 → БЕЗ капа упёрлось бы в 9.0.
    // Кап: lastActual=5.0 (<5.5 → 0.5/мес), maxGain=0.5/30·75=1.25 → окно [3.75,6.25],
    // projectedCapped=6.25 → дожатие gainHigh=floorHalf(6.25)=6.0 → projectedBand=6.0 (НЕ 9.0).
    // hw=0.5, коридор на 6.25: low=round½(5.75)=6.0, high=round½(6.75)=7.0.
    const steep: ForecastPoint[] = [0, 5, 10, 15].map((d, i) => ({
      t: day(d),
      band: 2.0 + i * 1.0,
    }));
    const now = new Date(day(15));
    const f = computeForecast(steep, "2026-04-01", 7, now); // day(90)
    expect(f.projectedBand).toBe(6.0); // ограничено тиром low-band, НЕ 9.0
    expect(f.projectedBand).toBeLessThan(9.0);
    expect(f.interval).toEqual({ low: 6.0, high: 7.0 });
    // Никаких NaN/Infinity на всех выходах.
    expect(Number.isFinite(f.projectedBand!)).toBe(true);
    expect(Number.isFinite(f.interval!.low)).toBe(true);
    expect(Number.isFinite(f.interval!.high)).toBe(true);
    expect(Number.isFinite(f.slopePerWeek!)).toBe(true);
  });

  it("абсолютный лимит связывает на дальнем горизонте (300 дней → +2.0, не rate×300)", () => {
    // bands 3→6 (slope 0.1) дни 0,10,20,30; NOW=day30, exam через 300 дней (day330=2026-11-27).
    // lastActual=6.0 (tier 0.4/мес=0.01333/день). rate×300=4.0 — абсурд; ABS_MAX_BAND_GAIN
    // связывает → maxGain=2.0. Окно [4.0,8.0], projectedRaw=3.0+0.1·330=36 → projectedCapped=8.0
    // → projectedBand=floorHalf(6.0+2.0)=8.0 (=lastActual+2.0), а не 9.0-кламп от rate×300.
    const steepFar: ForecastPoint[] = [
      { t: day(0), band: 3.0 },
      { t: day(10), band: 4.0 },
      { t: day(20), band: 5.0 },
      { t: day(30), band: 6.0 },
    ];
    const now = new Date(day(30));
    const f = computeForecast(steepFar, "2026-11-27", 8, now); // day(330)
    expect(f.projectedBand).toBe(8.0); // lastActual 6.0 + ABS_MAX 2.0
    expect(f.projectedBand).toBeLessThan(9.0); // абс-лимит, а не потолок шкалы
    expect(Number.isFinite(f.projectedBand!)).toBe(true);
    expect(Number.isFinite(f.interval!.low)).toBe(true);
    expect(Number.isFinite(f.interval!.high)).toBe(true);
    expect(Number.isFinite(f.slopePerWeek!)).toBe(true);
  });

  it("короткий горизонт: точка не пробивает окно капа округлением к 0.5 наружу", () => {
    // lastActual=7.0 (tier (1/3)/30), горизонт 8 дней → maxGain=8·(1/3)/30=0.0889, окно
    // [6.911,7.089]. Крутой сырой тренд даёт projectedRaw≈7.57, projectedCapped=7.089 —
    // БЛИЖАЙШАЯ 0.5 это 7.0 (round½), а дожатие gainHigh=floorHalf(7.089)=7.0 гарантирует, что
    // округление наружу окна не пробьёт кап и не даст ложный on_track для target 7.5.
    // Дни 0,10,20,30, bands 5.0,5.8,6.4,7.0; NOW=day30, exam=day38 (2026-02-08).
    const steepShort: ForecastPoint[] = [
      { t: day(0), band: 5.0 },
      { t: day(10), band: 5.8 },
      { t: day(20), band: 6.4 },
      { t: day(30), band: 7.0 },
    ];
    const now = new Date(day(30));
    const f = computeForecast(steepShort, "2026-02-08", 7.5, now); // day(38)
    const lastActual = 7.0;
    const maxGain = (8 * (1 / 3)) / 30;
    const capHigh = Math.floor((lastActual + maxGain) * 2) / 2; // floorHalf → 7.0
    expect(f.projectedBand).toBeLessThanOrEqual(capHigh);
    expect(f.projectedBand).toBe(7.0); // НЕ 7.5
    expect(Math.abs(f.projectedBand! - lastActual)).toBeLessThanOrEqual(maxGain + 1e-9);
    expect(f.verdict).toBe("behind"); // 7.0 < target 7.5, округление наружу не завышает
    expect(Number.isFinite(f.projectedBand!)).toBe(true);
  });

  it("тренд ниже тира (кап не связывает) → результат идентичен доканному (регрессия)", () => {
    // Наклон 0.01/день (≈0.3 band/мес) НИЖЕ тира band∈[5.5,7.0) (0.4/мес), поэтому кап инертен.
    // bands 6.0..6.4 на днях 0..40; exam day60. projectedRaw=6.0+0.01*60=6.6.
    // lastActual=6.4, maxGain=0.4/30·20=0.2667 → окно [6.133,6.667] ⊇ 6.6 → НЕ связывает,
    // projectedCapped=6.6 → как без капа: projectedBand=round½(6.6)=6.5, коридор ±0.5 на 6.6.
    const gentle: ForecastPoint[] = [0, 10, 20, 30, 40].map((d, i) => ({
      t: day(d),
      band: 6.0 + i * 0.1,
    }));
    const f = computeForecast(gentle, "2026-03-02", 7, NOW_AT_LAST); // day(60)
    expect(f.projectedBand).toBe(6.5);
    expect(f.interval).toEqual({ low: 6.0, high: 7.0 });
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
    // Горизонт day88: тир-3 даёт maxGain=(1/3)/30·48=0.533 → projectedBand=7.5 (latest 7.0<7.5).
    // На коротком day60 тир-3 не дотянул бы (кап +0.22 → 7.0) — нужен горизонт под темп.
    const f = computeForecast(RISING, "2026-03-30", 7.5, NOW_AT_LAST); // day(88), projected 7.5 ≥ 7.5
    expect(f.verdict).toBe("on_track");
  });

  it("проекция не дотягивает → behind", () => {
    const f = computeForecast(RISING, "2026-03-02", 8.5, NOW_AT_LAST); // day(60), projected 7.0 (капнута) < 8.5
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

/* -------------------------------------------------------------------------- */
/* buildOverallSeries                                                          */
/* -------------------------------------------------------------------------- */

describe("buildOverallSeries", () => {
  /**
   * Регрессия из прода (скрин владельца 2026-07-15): Reading 3.5 стоял между
   * Listening 2.0, и линия через сырой `combined` рисовала «башню» — отрезок
   * Listening→Reading заявлял скачок +1.5, которого не было (это разные тесты).
   * Инвариант: overall-линия строится по ОДНОЙ величине и таких зубцов не даёт.
   */
  const towerShape: TrajectoryAttempt[] = [
    { bandScore: 2, section: "listening", submittedAt: new Date(day(0)) },
    { bandScore: 2, section: "listening", submittedAt: new Date(day(1)) },
    { bandScore: 3.5, section: "reading", submittedAt: new Date(day(2)) },
    { bandScore: 2, section: "listening", submittedAt: new Date(day(3)) },
    { bandScore: 3.5, section: "reading", submittedAt: new Date(day(4)) },
  ];

  it("не даёт «башни» на форме со скрина: пила из 3 зубцов → одна ступенька", () => {
    const tr = buildTrajectory(towerShape);
    const raw = tr.combined.map((p) => p.band);
    const overall = buildOverallSeries(tr.combined).map((p) => p.band);
    const changes = (xs: number[]) => xs.slice(1).filter((b, i) => b !== xs[i]).length;

    // Сырое облако: 2 → 3.5 → 2 → 3.5, три смены подряд. Это и была «башня».
    expect(changes(raw)).toBe(3);

    // Overall: пока сдан только Listening — 2.0; пришёл Reading 3.5 → (3.5+2)/2 = 2.75 →
    // 3.0, и дальше держится, потому что ни R, ни L больше не менялись.
    expect(overall).toEqual([2, 2, 3, 3, 3]);
    // Ровно ОДНА смена — приход новой информации, а не рывок способностей. Пилы нет.
    expect(changes(overall)).toBe(1);
  });

  it("линия покрывает ВСЮ историю, а не только хвост с обеими секциями", () => {
    // Скрин владельца: Listening подряд, Reading только в конце. Пока overall требовал
    // обе секции, «твой band» появлялся лишь на последней пятой части графика — главная
    // линия превращалась в огрызок, и график читался как «точки в пустоте».
    const tr = buildTrajectory(towerShape);
    const overall = buildOverallSeries(tr.combined);
    expect(overall).toHaveLength(tr.combined.length);
    expect(overall[0].t).toBe(tr.combined[0].t);
    expect(overall[overall.length - 1].t).toBe(tr.combined[tr.combined.length - 1].t);
  });

  it("считает overall как среднее ПОСЛЕДНИХ R и L, округляя к 0.5 (как официальный)", () => {
    // L=2.0 один → 2.0; затем R=3.5 → (3.5+2)/2 = 2.75 → 3.0 (официальное: .75 вверх).
    expect(
      buildOverallSeries(
        buildTrajectory([
          { bandScore: 2, section: "listening", submittedAt: new Date(day(0)) },
          { bandScore: 3.5, section: "reading", submittedAt: new Date(day(1)) },
        ]).combined,
      ),
    ).toEqual([
      { t: day(0), band: 2 },
      { t: day(1), band: 3 },
    ]);

    // R=6.0 один → 6.0; затем L=7.0 → 6.5 ровно на сетке.
    expect(
      buildOverallSeries(
        buildTrajectory([
          { bandScore: 6, section: "reading", submittedAt: new Date(day(0)) },
          { bandScore: 7, section: "listening", submittedAt: new Date(day(1)) },
        ]).combined,
      ),
    ).toEqual([
      { t: day(0), band: 6 },
      { t: day(1), band: 6.5 },
    ]);
  });

  it("пока сдана одна секция — overall равен ей (та же конвенция, что buildReadiness)", () => {
    const tr = buildTrajectory([
      { bandScore: 5, section: "reading", submittedAt: new Date(day(0)) },
      { bandScore: 6, section: "reading", submittedAt: new Date(day(1)) },
      { bandScore: 3, section: "listening", submittedAt: new Date(day(2)) },
    ]);
    // Первые два мока — только Reading: лучшая оценка из известного = сам Reading.
    // Затем приходит Listening 3 → (6+3)/2 = 4.5. Ступенька = новая информация.
    expect(buildOverallSeries(tr.combined)).toEqual([
      { t: day(0), band: 5 },
      { t: day(1), band: 6 },
      { t: day(2), band: 4.5 },
    ]);
  });

  it("одна секция за всю историю → overall повторяет её; пустой вход → пусто", () => {
    const onlyReading = buildTrajectory([
      { bandScore: 5, section: "reading", submittedAt: new Date(day(0)) },
      { bandScore: 6, section: "reading", submittedAt: new Date(day(1)) },
    ]);
    expect(buildOverallSeries(onlyReading.combined).map((p) => p.band)).toEqual([5, 6]);
    expect(buildOverallSeries([])).toEqual([]);
  });

  it("держит ПОСЛЕДНИЙ результат секции, а не первый", () => {
    const tr = buildTrajectory([
      { bandScore: 4, section: "reading", submittedAt: new Date(day(0)) },
      { bandScore: 4, section: "listening", submittedAt: new Date(day(1)) },
      { bandScore: 8, section: "reading", submittedAt: new Date(day(2)) },
    ]);
    // Свежий Reading 8 вытесняет старый 4: (8+4)/2 = 6.
    expect(buildOverallSeries(tr.combined).map((p) => p.band)).toEqual([4, 4, 6]);
  });

  it("два мока в один момент дают одну точку — линия не описывает вертикаль", () => {
    const tr = buildTrajectory([
      { bandScore: 4, section: "listening", submittedAt: new Date(day(0)) },
      { bandScore: 4, section: "reading", submittedAt: new Date(day(1)) },
      { bandScore: 8, section: "reading", submittedAt: new Date(day(1)) },
    ]);
    const overall = buildOverallSeries(tr.combined);
    expect(new Set(overall.map((p) => p.t)).size).toBe(overall.length);
    // Побеждает последний по сортировке (t, band) мок той же секции: (8+4)/2 = 6.
    expect(overall).toEqual([
      { t: day(0), band: 4 },
      { t: day(1), band: 6 },
    ]);
  });

  it("overall всегда лежит между последними R и L — не выходит за свои же данные", () => {
    const tr = buildTrajectory([
      { bandScore: 2, section: "listening", submittedAt: new Date(day(0)) },
      { bandScore: 9, section: "reading", submittedAt: new Date(day(1)) },
      { bandScore: 4.5, section: "listening", submittedAt: new Date(day(2)) },
      { bandScore: 5, section: "reading", submittedAt: new Date(day(3)) },
    ]);
    for (const p of buildOverallSeries(tr.combined)) {
      const seen = tr.combined.filter((c) => c.t <= p.t).map((c) => c.band);
      expect(p.band).toBeGreaterThanOrEqual(Math.min(...seen));
      expect(p.band).toBeLessThanOrEqual(Math.max(...seen));
    }
  });

  it("прогноз продолжает есть сырой combined — buildOverallSeries его не трогает", () => {
    const tr = buildTrajectory(towerShape);
    const before = JSON.stringify(tr.combined);
    buildOverallSeries(tr.combined);
    expect(JSON.stringify(tr.combined)).toBe(before);
  });
});
