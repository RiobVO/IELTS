// Cookie-снимок пробы (G1-6). Граница доверия: значение приходит из браузера и идёт
// в грейдер и в рендер — «свой формат» тут не значит «валидный». Отдельно фиксируем
// главный инвариант: в cookie уходят ОТВЕТЫ, а не посчитанный слабый тип.
import { describe, it, expect } from "vitest";
import {
  parsePredictorCookie,
  serializePredictorCookie,
  toTeaser,
} from "./snapshot";

describe("parsePredictorCookie", () => {
  it("валидные ответы разбираются", () => {
    expect(parsePredictorCookie('{"1":"TRUE","4":"eighteen"}')).toEqual({
      "1": "TRUE",
      "4": "eighteen",
    });
  });

  it("отсутствующая/битая cookie → null, а не исключение", () => {
    expect(parsePredictorCookie(undefined)).toBeNull();
    expect(parsePredictorCookie("")).toBeNull();
    expect(parsePredictorCookie("{not json")).toBeNull();
    expect(parsePredictorCookie("[]")).toBeNull();
    expect(parsePredictorCookie("null")).toBeNull();
    expect(parsePredictorCookie("{}")).toBeNull();
  });

  it("ключи не-номера и не-строковые значения отбрасываются", () => {
    expect(parsePredictorCookie('{"1":"TRUE","w":"tfng","2":42,"__proto__":"x"}')).toEqual({
      "1": "TRUE",
    });
  });

  it("длинные значения обрезаются, лишние пары отсекаются (cookie-бомба)", () => {
    const long = parsePredictorCookie(JSON.stringify({ "1": "x".repeat(500) }));
    expect(long!["1"]!.length).toBeLessThanOrEqual(80);

    const many: Record<string, string> = {};
    for (let i = 1; i <= 60; i++) many[String(i)] = "TRUE";
    expect(Object.keys(parsePredictorCookie(JSON.stringify(many))!).length).toBeLessThanOrEqual(20);
  });

  it("сериализация и разбор — обратимая пара", () => {
    const answers = { "1": "TRUE", "10": "doubled" };
    expect(parsePredictorCookie(serializePredictorCookie(answers))).toEqual(answers);
  });

  it("в cookie не попадает ничего, кроме ответов (слабый тип там больше не живёт)", () => {
    const raw = serializePredictorCookie({ "1": "TRUE", "2": "FALSE" });
    expect(raw).not.toContain("tfng");
    expect(raw).not.toMatch(/"w"/);
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
