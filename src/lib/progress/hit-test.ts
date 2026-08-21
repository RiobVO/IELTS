/**
 * Хит-тест для интерактивного line-чарта (TrajectoryChart): по курсору/пальцу
 * найти индекс ближайшей точки в системе координат viewBox.
 *
 * X первичен — это UX вертикального визира line-чарта: пользователь целится
 * вдоль оси времени, и «ближайшая по X» почти всегда и есть точка, которую он
 * хочет. Но когда два мока разных секций сданы с разницей в минуты (Reading и
 * Listening в один день), их X отличаются меньше пикселя — X-дистанции внутри
 * `epsX` практически неразличимы, и без Y-дизамбигуации всегда побеждал первый
 * по индексу: нижнюю точку было невозможно выбрать мышью/тапом (клавиатура не
 * страдала — она ходит по индексу напрямую). Поэтому среди точек, чей X лежит
 * в пределах `epsX` от лучшей по X, довыбираем ближайшую по Y.
 *
 * `epsX` — в единицах viewBox чарта (не экранные пиксели: SVG масштабируется
 * под ширину контейнера), дефолт 8 — снэп в пределах, где точки визуально
 * неразличимы по X на характерном viewBox TrajectoryChart.
 */
export function pickPointIndex(
  points: { x: number; y: number }[],
  vx: number,
  vy: number,
  epsX = 8,
): number | null {
  if (points.length === 0) return null;

  let bestXIdx = 0;
  let bestXD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.abs(points[i].x - vx);
    if (d < bestXD) { bestXD = d; bestXIdx = i; }
  }

  const xBest = points[bestXIdx].x;
  let best = bestXIdx;
  let bestYD = Infinity;
  for (let i = 0; i < points.length; i++) {
    if (Math.abs(points[i].x - xBest) > epsX) continue;
    const dy = Math.abs(points[i].y - vy);
    if (dy < bestYD) { bestYD = dy; best = i; }
  }
  return best;
}
