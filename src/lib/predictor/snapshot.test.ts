// Разбор cookie-снимка пробы (G1-6). Граница доверия: значение приходит из
// браузера и идёт прямиком в рендер — «свой формат» тут не значит «валидный».
import { describe, it, expect } from "vitest";
import { parsePredictorCookie } from "./snapshot";

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
