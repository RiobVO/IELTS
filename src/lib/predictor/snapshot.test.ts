// Разбор cookie-снимка пробы (G1-6). Граница доверия: значение приходит из
// браузера и идёт прямиком в рендер — «свой формат» тут не значит «валидный».
import { describe, it, expect } from "vitest";
import { parsePredictorCookie, toTeaser } from "./snapshot";

describe("parsePredictorCookie", () => {
  it("валидный снимок разбирается", () => {
    expect(parsePredictorCookie('{"c":7,"t":10,"w":"tfng","l":6,"h":6.5}')).toEqual({
      c: 7,
      t: 10,
      w: "tfng",
      l: 6,
      h: 6.5,
    });
  });

  it("идеальная проба без слабого типа", () => {
    expect(parsePredictorCookie('{"c":10,"t":10,"w":null,"l":7.5,"h":8.5}')?.w).toBeNull();
  });

  it("отсутствующая/битая cookie → null, а не исключение", () => {
    expect(parsePredictorCookie(undefined)).toBeNull();
    expect(parsePredictorCookie("")).toBeNull();
    expect(parsePredictorCookie("{not json")).toBeNull();
    expect(parsePredictorCookie("[]")).toBeNull();
    expect(parsePredictorCookie("null")).toBeNull();
  });

  it("невозможные числа отвергаются целиком", () => {
    expect(parsePredictorCookie('{"c":11,"t":10,"w":null,"l":6,"h":6.5}')).toBeNull(); // верных больше, чем всего
    expect(parsePredictorCookie('{"c":-1,"t":10,"w":null,"l":6,"h":6.5}')).toBeNull();
    expect(parsePredictorCookie('{"c":5,"t":0,"w":null,"l":6,"h":6.5}')).toBeNull();
    expect(parsePredictorCookie('{"c":5,"t":10,"w":null,"l":6,"h":5}')).toBeNull(); // верх ниже низа
    expect(parsePredictorCookie('{"c":5,"t":10,"w":null,"l":6,"h":42}')).toBeNull(); // band вне шкалы
    expect(parsePredictorCookie('{"c":"7","t":"ten","w":null,"l":6,"h":6.5}')).toBeNull();
  });

  it("пустой слабый тип нормализуется в null (а не в пустую подпись)", () => {
    expect(parsePredictorCookie('{"c":5,"t":10,"w":"","l":5.5,"h":6}')?.w).toBeNull();
  });
});

describe("toTeaser", () => {
  const snap = { c: 6, t: 10, w: "matching_headings", l: 5.5, h: 6 };

  it("гостю НЕ отдаёт название слабого типа, только факт находки", () => {
    const view = toTeaser(snap, false);
    expect(view.w).toBeNull();
    expect(view.hasWeak).toBe(true);
    expect(JSON.stringify(view)).not.toContain("matching_headings");
  });

  it("залогиненному отдаёт тип целиком", () => {
    expect(toTeaser(snap, true).w).toBe("matching_headings");
  });

  it("идеальная проба: слабого типа нет ни у кого", () => {
    const clean = { ...snap, w: null };
    expect(toTeaser(clean, true).hasWeak).toBe(false);
    expect(toTeaser(clean, false).hasWeak).toBe(false);
  });

  it("счёт и границы диапазона видны обоим — это не гейтится", () => {
    for (const authed of [true, false]) {
      const v = toTeaser(snap, authed);
      expect([v.c, v.t, v.l, v.h]).toEqual([6, 10, 5.5, 6]);
    }
  });
});
