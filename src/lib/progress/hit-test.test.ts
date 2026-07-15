import { describe, it, expect } from "vitest";
import { pickPointIndex } from "./hit-test";

describe("pickPointIndex — репро бага: точки с почти равным X (Reading/Listening в один день)", () => {
  // x=100 (индекс 0) и x=100.5 (индекс 1) — дельта меньше пикселя на реальном
  // viewBox. Курсор чуть ближе к индексу 0 по X (0.2 против 0.3), поэтому
  // СТАРАЯ x-only логика всегда выбирала индекс 0, независимо от Y — нижнюю
  // точку (y=200) нельзя было выбрать вообще.
  const points = [
    { x: 100, y: 50 },
    { x: 100.5, y: 200 },
  ];

  it("курсор у нижней точки (vy=190) → выбирается нижняя (индекс 1)", () => {
    expect(pickPointIndex(points, 100.2, 190)).toBe(1);
  });

  it("курсор у верхней точки (vy=60) → выбирается верхняя (индекс 0)", () => {
    expect(pickPointIndex(points, 100.2, 60)).toBe(0);
  });
});

describe("pickPointIndex — обычный кейс: X разнесены далеко", () => {
  it("побеждает ближайшая по X точка, даже если Y другой точки ближе к курсору", () => {
    const points = [
      { x: 10, y: 500 },
      { x: 200, y: 0 },
    ];
    // vy=0 совпадает с Y второй точки, но курсор (vx=15) стоит вплотную к
    // первой по X — X первичен, Y решает только среди X-кандидатов.
    expect(pickPointIndex(points, 15, 0)).toBe(0);
  });
});

describe("pickPointIndex — пустой массив", () => {
  it("возвращает null", () => {
    expect(pickPointIndex([], 0, 0)).toBeNull();
  });
});

describe("pickPointIndex — точки за пределами epsX не участвуют в Y-выборе", () => {
  it("точка с лучшим Y, но далёкая по X, игнорируется", () => {
    const points = [
      { x: 100, y: 10 },
      { x: 100, y: 1000 },
      { x: 200, y: 5 }, // Y практически совпадает с vy, но x=200 вне epsX=8
    ];
    expect(pickPointIndex(points, 100.1, 5, 8)).toBe(0);
  });
});
