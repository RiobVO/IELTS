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

import { useCallback, useEffect, useRef, useState } from "react";

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

// Три РАЗНЫХ hue на белом плоте, каждый ≥3:1 (WCAG 1.4.11): reading — синий
// (--info-text, hue 232), listening — зелёный (--green-600, hue 158), combined
// несёт brand-фиолет (hue 292) отдельно. Раньше listening был фиолетовым и сливался
// с brand-линией Combined; развели по hue. Форма точек (круг/ромб) дублирует
// различение при дальтонизме, цвет — вторичный сигнал.
const SECTION_COLOR = { reading: "var(--info-text)", listening: "var(--green-600)" } as const;
// На ТЁМНОМ фоне тултипа тёмные цвета слились бы — точке-свотчу даём светлые
// варианты того же hue (текст рядом всё равно называет секцию явно).
const SECTION_DOT = { reading: "var(--sky-500)", listening: "var(--green-500)" } as const;
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
  // Видимость сплит-серий: обе включены по умолчанию, тап по легенде гасит шумную
  // Reading/Listening, оставляя чистую Combined-линию (Combined не гасится). Стартуем
  // пустым (совпадает с SSR — избегаем hydration mismatch), затем подтягиваем выбор
  // из sessionStorage: пользователь, погасивший серию, не включает её заново каждую
  // навигацию/перезагрузку (тот же per-session-паттерн, что motion-гейт).
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("ov-series-hidden");
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {
      // sessionStorage недоступен (private mode) — остаёмся на «всё видно».
    }
  }, []);
  const toggle = useCallback((s: string) => {
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      try {
        sessionStorage.setItem("ov-series-hidden", JSON.stringify([...n]));
      } catch {
        // персист необязателен — тогл работает и без него.
      }
      return n;
    });
  }, []);

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
  // Тултип ставится РОВНО над точкой (left/top = координата точки в %); от overflow
  // спасаем не клампом центра (он рассинхронил бы стрелку), а сменой якоря: у левого
  // края бокс растёт вправо (стрелка у левого края), у правого — влево; по вертикали
  // у верха плота бокс флипается ВНИЗ, чтобы не наехать на заголовок карты.
  const pointXPct = act ? (act.x / w) * 100 : 0;
  const pointYPct = act ? (act.y / h) * 100 : 0;
  const tipEdge = pointXPct < 20 ? "left" : pointXPct > 80 ? "right" : "center";
  const tipBelow = pointYPct < 26;
  const tipTx = tipEdge === "left" ? "16px" : tipEdge === "right" ? "calc(-100% + 16px)" : "-50%";
  const tipTy = tipBelow ? "16px" : "calc(-100% - 14px)";
  // Сплит-легенда/тогл имеют смысл только когда есть ОБЕ серии (иначе combined ==
  // единственной сплит-линии — гасить нечего, а подпись не должна называть отсутствующую).
  const hasSplit = !!reading && !!listening;

  return (
    <>
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
        {/* Только ЛИНИИ сетки/цели/экзамена — подписи вынесены в HTML-оверлей ниже
            (фикс-кегль на любой ширине; SVG-текст на 360px схлопывался до ~4.8px). */}
        {grid.map((g) => (
          <line key={g.band} x1={padL} x2={w - padR} y1={g.y} y2={g.y} stroke="var(--border-subtle)" strokeWidth={1} />
        ))}

        {target && (
          // --warn-text (L0.520 ≈3.9:1), не сырой gold: линия — значимый индикатор,
          // применяется 1.4.11 (3:1); пунктир и так отличает её от data-линий.
          <line x1={padL} x2={w - padR} y1={target.y} y2={target.y} stroke="var(--warn-text)" strokeWidth={1.5} strokeDasharray="5 4" />
        )}

        {exam && (
          <line x1={exam.x} x2={exam.x} y1={padT} y2={h - padB} stroke="var(--brand-active)" strokeWidth={1.5} strokeDasharray="3 3" />
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

        {reading && !hidden.has("reading") && (
          <polyline data-draw={reading.len} points={reading.attr} fill="none" stroke={SECTION_COLOR.reading} strokeWidth={1.5}
            strokeDasharray={reading.len} strokeDashoffset={0} strokeLinecap="round" strokeLinejoin="round" />
        )}
        {listening && !hidden.has("listening") && (
          <polyline data-draw={listening.len} points={listening.attr} fill="none" stroke={SECTION_COLOR.listening} strokeWidth={1.5}
            strokeDasharray={listening.len} strokeDashoffset={0} strokeLinecap="round" strokeLinejoin="round" />
        )}
        <polyline data-draw={combinedLen} points={combinedAttr} fill="none" stroke="var(--brand)" strokeWidth={2.5}
          strokeDasharray={combinedLen} strokeDashoffset={0} strokeLinecap="round" strokeLinejoin="round" />

        {/* Секцию несёт НЕ только цвет: Reading — круг, Listening — ромб. Форма
            остаётся различимой при дальтонизме (WCAG 1.4.1); цвет — вторичный сигнал.
            Точки погашенной серии не рисуем. */}
        {combined.map((p, i) =>
          hidden.has(p.section) ? null : p.section === "listening" ? (
            <rect
              key={i}
              x={p.x - 2.6}
              y={p.y - 2.6}
              width={5.2}
              height={5.2}
              transform={`rotate(45 ${p.x} ${p.y})`}
              fill={SECTION_COLOR[p.section]}
            />
          ) : (
            <circle key={i} cx={p.x} cy={p.y} r={2.6} fill={SECTION_COLOR[p.section]} />
          ),
        )}

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

        {/* Прозрачная область-приёмник поверх — ловит курсор и между линиями. */}
        <rect x={padL} y={padT} width={w - padL - padR} height={h - padT - padB} fill="transparent" style={{ cursor: "crosshair" }} />
      </svg>

      {/* HTML-оверлей подписей: фикс-кегль (var(--text-2xs)) на любой ширине контейнера,
          позиционирование в % от того же viewBox (та же техника, что у тултипа). SVG-текст
          масштабировался вместе с viewBox и на узком телефоне падал до ~4.8px. */}
      <div className="ov-labels" aria-hidden="true">
        {grid.map((g) => (
          <span key={g.band} className="ov-lbl ov-lbl-grid" style={{ left: `${((padL - 7) / w) * 100}%`, top: `${(g.y / h) * 100}%` }}>
            {g.band}
          </span>
        ))}
        {target && (
          <span className="ov-lbl ov-lbl-target" style={{ left: `${((w - padR) / w) * 100}%`, top: `${(target.y / h) * 100}%` }}>
            Target {target.band}
          </span>
        )}
        {exam && (
          <span
            className="ov-lbl ov-lbl-exam"
            style={{ left: `${(exam.x / w) * 100}%`, top: `${((padT + 4) / h) * 100}%`, transform: exam.rightEdge ? "translate(-100%, 0)" : "translate(0, 0)", paddingInline: 4 }}
          >
            Exam
          </span>
        )}
        {!act && (
          <span className="ov-lbl ov-lbl-latest" style={{ left: `${(combined[combined.length - 1].x / w) * 100}%`, top: `${(combined[combined.length - 1].y / h) * 100}%` }}>
            {latestBand.toFixed(1)}
          </span>
        )}
        <span className="ov-lbl ov-lbl-axis" style={{ left: `${(padL / w) * 100}%`, bottom: 0 }}>{xLabelLeft}</span>
        <span className="ov-lbl ov-lbl-axis ov-lbl-axis-r" style={{ left: `${((w - padR) / w) * 100}%`, bottom: 0 }}>{xLabelRight}</span>
      </div>

      {act && (
        <div
          className={`ov-tip ov-tip-${tipEdge}${tipBelow ? " ov-tip-below" : ""}`}
          role="status"
          style={{ left: `${pointXPct}%`, top: `${pointYPct}%`, transform: `translate(${tipTx}, ${tipTy})` }}
        >
          <div className="ov-tip-date">{fmtFull(act.dateMs)}</div>
          <div className="ov-tip-band">
            <span className="ov-tip-dot" style={{ background: SECTION_DOT[act.section] }} />
            {SECTION_LABEL[act.section]} · <b>{act.band.toFixed(1)}</b>
          </div>
          {delta != null && (
            <div
              className="ov-tip-delta"
              style={{
                // Тултип тёмный (--surface-inverse) — тёмные *-text (для светлых
                // поверхностей) давали ~2.6:1. На тёмном берём светлые варианты.
                color:
                  delta > 0
                    ? "var(--green-500)"
                    : delta < 0
                      ? "color-mix(in oklab, var(--red-500) 72%, white)"
                      : "color-mix(in oklab, var(--surface-inverse-ink) 62%, transparent)",
              }}
            >
              {delta === 0 ? "No change vs previous mock" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} vs previous mock`}
            </div>
          )}
        </div>
      )}
    </div>

      {/* Легенда — сиблинг .ov-chart, не внутри, иначе % оверлея подписей считались
          бы от более высокого контейнера. Тогл R/L показываем ТОЛЬКО когда есть обе
          секции: при single-section combined совпадает со сплит-линией, гасить нечего,
          а note не должна называть несуществующую серию. Combined-чип статичен;
          R/L — bordered pill-кнопки, чтобы на тач было видно, что это контролы. */}
      <div className="ov-legend">
        <span className="ov-leg-item ov-leg-static">
          <span className="ov-leg-swatch ov-leg-line" style={{ background: "var(--brand)" }} /> Combined
        </span>
        {hasSplit && (
          <>
            <button type="button" className="ov-leg-item ov-leg-btn" aria-pressed={!hidden.has("reading")} aria-label={hidden.has("reading") ? "Show Reading line" : "Hide Reading line"} onClick={() => toggle("reading")}>
              <span className="ov-leg-swatch ov-leg-circle" style={{ background: SECTION_COLOR.reading }} /> Reading
            </button>
            <button type="button" className="ov-leg-item ov-leg-btn" aria-pressed={!hidden.has("listening")} aria-label={hidden.has("listening") ? "Show Listening line" : "Hide Listening line"} onClick={() => toggle("listening")}>
              <span className="ov-leg-swatch ov-leg-diamond" style={{ background: SECTION_COLOR.listening }} /> Listening
            </button>
          </>
        )}
      </div>
      {hasSplit && (
        <p className="ov-legend-note">Combined is your band across every mock; Reading and Listening split it by section. Tap or click a section to hide its line.</p>
      )}
    </>
  );
}
