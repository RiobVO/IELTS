import { describe, it, expect } from "vitest";
import { monotoneSegs, bezierAt, smoothD, type Scaled } from "./curve";

/**
 * Регрессия из реальных данных владельца (скрин 2026-07-15): серия моков, все ровно
 * на band 2.0, затем скачок на 3.5 и обратно. Равномерный Catmull-Rom, стоявший тут
 * раньше, на плоском участке протаскивал линию НИЖЕ 2.0 (ниже собственной сетки), а
 * на скачке рисовал касп с выбросом. Цифры ниже — реальная геометрия hero-графика:
 * viewBox 680×272, PAD {t:18, b:28} → PH=226, домен band [1.5, 6.5].
 */
const yFor = (band: number) => 18 + (1 - (band - 1.5) / 5) * 226;
const Y2 = yFor(2.0); // 221.4
const Y35 = yFor(3.5); // 153.6

/** Плотное сэмплирование кривой: [{x,y}] по всем сегментам. */
function sample(pts: Scaled[], per = 200): Scaled[] {
  return monotoneSegs(pts).flatMap((s) =>
    Array.from({ length: per + 1 }, (_, i) => bezierAt(s, i / per)),
  );
}

/** Максимальный выход кривой за диапазон [min,max] СВОИХ концов, по каждому сегменту. */
function maxOvershoot(pts: Scaled[], per = 200): number {
  let worst = 0;
  for (const s of monotoneSegs(pts)) {
    const lo = Math.min(s.p1.y, s.p2.y);
    const hi = Math.max(s.p1.y, s.p2.y);
    for (let i = 0; i <= per; i++) {
      const { y } = bezierAt(s, i / per);
      worst = Math.max(worst, lo - y, y - hi, 0);
    }
  }
  return worst;
}

describe("monotoneSegs — кривая не врёт про данные", () => {
  it("держит плоский участок ровно плоским (баг со скрина: провал ниже band 2.0)", () => {
    // Пять моков подряд на 2.0, затем скачок — именно сосед-скачок раньше утаскивал
    // ПРЕДЫДУЩИЙ плоский отрезок вниз.
    const pts: Scaled[] = [
      { x: 60, y: Y2 },
      { x: 80, y: Y2 },
      { x: 200, y: Y2 },
      { x: 480, y: Y2 },
      { x: 520, y: Y35 },
    ];
    // На плоском участке (первые 4 точки) КАЖДЫЙ сэмпл обязан быть ровно на Y2.
    const flat = sample(pts.slice(0, 4));
    for (const p of flat) expect(p.y).toBeCloseTo(Y2, 9);
    // Ни один сэмпл всей кривой не опускается ниже линии band 2.0 (y растёт вниз).
    for (const p of sample(pts)) expect(p.y).toBeLessThanOrEqual(Y2 + 1e-9);
  });

  it("не перелетает пик (баг со скрина: касп выше band 3.5)", () => {
    const pts: Scaled[] = [
      { x: 200, y: Y2 },
      { x: 480, y: Y2 },
      { x: 520, y: Y35 },
      { x: 560, y: Y2 },
      { x: 600, y: Y35 },
    ];
    // Кривая целиком живёт в диапазоне самих данных: не выше 3.5 и не ниже 2.0.
    for (const p of sample(pts)) {
      expect(p.y).toBeGreaterThanOrEqual(Y35 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(Y2 + 1e-9);
    }
    expect(maxOvershoot(pts)).toBeCloseTo(0, 9);
  });

  it("не выходит за диапазон соседних точек ни на одном сегменте (общий инвариант)", () => {
    const shapes: Scaled[][] = [
      [{ x: 0, y: 100 }, { x: 50, y: 20 }, { x: 100, y: 100 }], // пик
      [{ x: 0, y: 20 }, { x: 50, y: 100 }, { x: 100, y: 20 }], // впадина
      [{ x: 0, y: 200 }, { x: 10, y: 40 }, { x: 300, y: 42 }, { x: 310, y: 200 }], // резкие края
      [{ x: 0, y: 90 }, { x: 5, y: 88 }, { x: 400, y: 30 }, { x: 405, y: 31 }], // кластеры по краям
    ];
    for (const pts of shapes) expect(maxOvershoot(pts)).toBeCloseTo(0, 9);
  });

  it("проходит РОВНО через каждую точку данных — маркеры не должны висеть мимо линии", () => {
    const pts: Scaled[] = [
      { x: 60, y: Y2 },
      { x: 200, y: Y2 },
      { x: 520, y: Y35 },
      { x: 560, y: Y2 },
    ];
    const segs = monotoneSegs(pts);
    expect(segs).toHaveLength(pts.length - 1);
    segs.forEach((s, i) => {
      expect(bezierAt(s, 0)).toEqual(pts[i]);
      expect(bezierAt(s, 1)).toEqual(pts[i + 1]);
    });
  });

  it("сохраняет монотонность: у растущих данных кривая нигде не идёт вниз", () => {
    const pts: Scaled[] = [
      { x: 0, y: Y2 },
      { x: 100, y: yFor(2.5) },
      { x: 200, y: yFor(3.0) },
      { x: 300, y: Y35 },
    ];
    const ys = sample(pts).map((p) => p.y);
    // y убывает (band растёт) — строго без локальных откатов.
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThanOrEqual(ys[i - 1] + 1e-9);
  });

  it("переживает вырожденные входы: <2 точек и совпадающие timestamp'ы", () => {
    expect(monotoneSegs([])).toEqual([]);
    expect(monotoneSegs([{ x: 10, y: 20 }])).toEqual([]);
    // Два мока с одним timestamp → h=0. Раньше это дало бы деление на ноль.
    const dup: Scaled[] = [
      { x: 100, y: Y2 },
      { x: 100, y: Y35 },
      { x: 300, y: Y2 },
    ];
    for (const s of monotoneSegs(dup)) {
      for (const v of [s.c1.x, s.c1.y, s.c2.x, s.c2.y]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("smoothD", () => {
  it("две точки дают ровно один сегмент — прямую", () => {
    const pts: Scaled[] = [{ x: 0, y: Y2 }, { x: 100, y: Y2 }];
    expect(monotoneSegs(pts)).toHaveLength(1);
    for (const p of sample(pts)) expect(p.y).toBeCloseTo(Y2, 9);
  });

  it("smoothD стартует с M и даёт по одному C на сегмент", () => {
    expect(smoothD([])).toBe("");
    expect(smoothD([{ x: 5, y: 6 }])).toBe("M 5.0 6.0");
    const d = smoothD([{ x: 0, y: Y2 }, { x: 100, y: Y2 }, { x: 200, y: Y35 }]);
    expect(d.startsWith("M 0.0 221.4")).toBe(true);
    expect(d.match(/C /g)).toHaveLength(2);
  });
});
