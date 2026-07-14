"use client";

/**
 * Интерактивный график траектории. Серверная часть (OverviewPanel) считает ВСЮ
 * геометрию (домены, шкалы, координаты в системе viewBox) и передаёт готовые
 * числа/строки — здесь только рендер того же SVG, что рисовался инлайн раньше,
 * ПЛЮС слой наведения: вертикальный визир, подсвеченная точка и HTML-подсказка
 * с реальным band/датой/дельтой той точки, над которой курсор (или палец).
 *
 * Почему HTML-подсказка, а не SVG-текст: viewBox масштабируется под ширину
 * контейнера, и 9px-текст на узком телефоне схлопывается до ~4px. HTML-слой даёт
 * чёткий фиксированный кегль на любой ширине. Клавиатура (←/→/Home/End) двигает
 * активную точку — hover-only readout иначе недоступен с клавиатуры (WCAG).
 *
 * SSR/no-JS/reduced-motion: разметка уже финальна (линии нарисованы, значения на
 * месте) — интерактив лишь надстройка после гидрации, как OverviewMotion.
 */

import { useCallback, useRef, useState } from "react";

export interface ChartPoint {
  x: number;
  y: number;
  band: number;
  dateMs: number;
  section: "reading" | "listening";
}

export interface TrajectoryChartProps {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  combined: ChartPoint[];
  combinedAttr: string;
  combinedLen: number;
  reading: { attr: string; len: number } | null;
  listening: { attr: string; len: number } | null;
  grid: { band: number; y: number }[];
  target: { y: number; band: number } | null;
  exam: { x: number; rightEdge: boolean } | null;
  forecast: { lastX: number; lastY: number; horizonX: number; projY: number; lowY: number; highY: number } | null;
  xLabelLeft: string;
  xLabelRight: string;
  latestBand: number;
}

const SECTION_COLOR = { reading: "var(--sky-500)", listening: "var(--violet-300)" } as const;
const SECTION_LABEL = { reading: "Reading", listening: "Listening" } as const;

function fmtFull(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

export function TrajectoryChart({
  w, h, padL, padR, padT, padB,
  combined, combinedAttr, combinedLen,
  reading, listening, grid, target, exam, forecast,
  xLabelLeft, xLabelRight, latestBand,
}: TrajectoryChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);

  // clientX → ближайшая точка по X (в системе viewBox через отношение rect).
  const pick = useCallback(
    (clientX: number) => {
      const svg = svgRef.current;
      if (!svg || combined.length === 0) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;
      const vx = ((clientX - rect.left) / rect.width) * w;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < combined.length; i++) {
        const d = Math.abs(combined[i].x - vx);
        if (d < bestD) { bestD = d; best = i; }
      }
      setActive(best);
    },
    [combined, w],
  );

  const onMove = useCallback((e: React.PointerEvent) => pick(e.clientX), [pick]);
  const onLeave = useCallback(() => setActive(null), []);
  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (combined.length === 0) return;
      if (e.key === "ArrowRight") { e.preventDefault(); setActive((a) => Math.min((a ?? -1) + 1, combined.length - 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setActive((a) => Math.max((a ?? combined.length) - 1, 0)); }
      else if (e.key === "Home") { e.preventDefault(); setActive(0); }
      else if (e.key === "End") { e.preventDefault(); setActive(combined.length - 1); }
      else if (e.key === "Escape") { setActive(null); }
    },
    [combined.length],
  );

  // Защита экспортируемого клиентского компонента: без точек рисовать нечего
  // (в текущем потоке TrajectoryHero не вызывает нас с пустым, но контракт
  // держим честным — ниже идёт доступ к combined[last]). Все хуки уже вызваны.
  if (combined.length === 0) return null;

  const act = active != null ? combined[active] : null;
  const prev = active != null && active > 0 ? combined[active - 1] : null;
  const delta = act && prev ? act.band - prev.band : null;
  const leftPct = act ? Math.max(15, Math.min(85, (act.x / w) * 100)) : 0;
  const topPct = act ? (act.y / h) * 100 : 0;

  return (
    <div className="ov-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height="auto"
        role="img"
        tabIndex={0}
        aria-label={`Band trajectory across ${combined.length} full ${combined.length === 1 ? "mock" : "mocks"}, latest band ${latestBand.toFixed(1)}. Use arrow keys to inspect each point.`}
        className="ov-chart-svg"
        style={{ display: "block", width: "100%", height: "auto", touchAction: "pan-y" }}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={onLeave}
        onBlur={onLeave}
        onKeyDown={onKey}
      >
        {grid.map((g) => (
          <g key={g.band}>
            <line x1={padL} x2={w - padR} y1={g.y} y2={g.y} stroke="var(--border-subtle)" strokeWidth={1} />
            <text x={padL - 6} y={g.y + 3} textAnchor="end" fontSize={9} fontFamily="var(--font-mono)" fill="var(--text-muted)">
              {g.band}
            </text>
          </g>
        ))}

        {target && (
          <>
            <line x1={padL} x2={w - padR} y1={target.y} y2={target.y} stroke="var(--gold-500)" strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={w - padR} y={target.y - 5} textAnchor="end" fontSize={9} fontFamily="var(--font-ui)" fontWeight={700} fill="var(--gold-500)">
              Target {target.band}
            </text>
          </>
        )}

        {exam && (
          <>
            <line x1={exam.x} x2={exam.x} y1={padT} y2={h - padB} stroke="var(--brand-active)" strokeWidth={1.5} strokeDasharray="3 3" />
            {/* Подпись уводим ниже верхней рамки (padT+16), чтобы не липла к краю
                плота и первой линии сетки; у правого края — anchor=end влево от линии. */}
            {exam.rightEdge ? (
              <text x={exam.x - 5} y={padT + 16} textAnchor="end" fontSize={9} fontFamily="var(--font-ui)" fontWeight={700} fill="var(--brand-active)">Exam</text>
            ) : (
              <text x={exam.x + 5} y={padT + 16} fontSize={9} fontFamily="var(--font-ui)" fontWeight={700} fill="var(--brand-active)">Exam</text>
            )}
          </>
        )}

        {forecast && (
          <>
            <polygon
              data-fade
              points={`${forecast.lastX.toFixed(1)},${forecast.lastY.toFixed(1)} ${forecast.horizonX.toFixed(1)},${forecast.highY.toFixed(1)} ${forecast.horizonX.toFixed(1)},${forecast.lowY.toFixed(1)}`}
              fill="color-mix(in oklab, var(--brand) 16%, transparent)"
            />
            <line
              data-fade
              x1={forecast.lastX} y1={forecast.lastY} x2={forecast.horizonX} y2={forecast.projY}
              stroke="var(--brand)" strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round"
            />
          </>
        )}

        {reading && (
          <polyline data-draw={reading.len} points={reading.attr} fill="none" stroke="var(--sky-500)" strokeWidth={1.5}
            strokeDasharray={reading.len} strokeDashoffset={0} strokeLinecap="round" strokeLinejoin="round" opacity={0.65} />
        )}
        {listening && (
          <polyline data-draw={listening.len} points={listening.attr} fill="none" stroke="var(--violet-300)" strokeWidth={1.5}
            strokeDasharray={listening.len} strokeDashoffset={0} strokeLinecap="round" strokeLinejoin="round" opacity={0.65} />
        )}
        <polyline data-draw={combinedLen} points={combinedAttr} fill="none" stroke="var(--brand)" strokeWidth={2.5}
          strokeDasharray={combinedLen} strokeDashoffset={0} strokeLinecap="round" strokeLinejoin="round" />

        {combined.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={SECTION_COLOR[p.section]} />
        ))}

        {/* Визир + подсвеченная точка (только при наведении/фокусе). */}
        {act && (
          <g pointerEvents="none" className="ov-cross">
            <line x1={act.x} x2={act.x} y1={padT} y2={h - padB} stroke="var(--brand)" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
            <circle cx={act.x} cy={act.y} r={6} fill="none" stroke="var(--brand)" strokeWidth={2} />
            <circle cx={act.x} cy={act.y} r={3} fill="var(--brand)" />
          </g>
        )}

        <circle data-pop cx={combined[combined.length - 1].x} cy={combined[combined.length - 1].y} r={5}
          fill="var(--brand)" stroke="var(--surface)" strokeWidth={2}
          style={{ transformBox: "fill-box", transformOrigin: "center" }} />
        {!act && (
          <text x={Math.min(combined[combined.length - 1].x + 8, w - padR - 24)} y={combined[combined.length - 1].y - 8}
            fontSize={10} fontWeight={700} fontFamily="var(--font-mono)" fill="var(--text-primary)">
            {latestBand.toFixed(1)}
          </text>
        )}

        <text x={padL} y={h - 6} fontSize={9} fontFamily="var(--font-ui)" fill="var(--text-muted)">{xLabelLeft}</text>
        <text x={w - padR} y={h - 6} textAnchor="end" fontSize={9} fontFamily="var(--font-ui)" fill="var(--text-muted)">{xLabelRight}</text>

        {/* Прозрачная область-приёмник поверх — ловит курсор и между линиями. */}
        <rect x={padL} y={padT} width={w - padL - padR} height={h - padT - padB} fill="transparent" style={{ cursor: "crosshair" }} />
      </svg>

      {act && (
        <div className="ov-tip" role="status" style={{ left: `${leftPct}%`, top: `${topPct}%` }}>
          <div className="ov-tip-date">{fmtFull(act.dateMs)}</div>
          <div className="ov-tip-band">
            <span className="ov-tip-dot" style={{ background: SECTION_COLOR[act.section] }} />
            {SECTION_LABEL[act.section]} · <b>{act.band.toFixed(1)}</b>
          </div>
          {delta != null && (
            <div
              className="ov-tip-delta"
              style={{ color: delta > 0 ? "var(--success-text)" : delta < 0 ? "var(--error-text)" : "color-mix(in oklab, var(--surface-inverse-ink) 62%, transparent)" }}
            >
              {delta === 0 ? "No change vs previous mock" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} vs previous mock`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
