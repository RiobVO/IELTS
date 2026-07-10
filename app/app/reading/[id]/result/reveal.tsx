"use client";

/**
 * Result reveal primitives — shared by the coach result screen (ResultCoach).
 *
 * Invariant: the final state is hardcoded in the markup (SSR/no-JS sees it
 * immediately). Animation is only WAAPI/rAF layered on top of an
 * already-correct DOM, and is skipped entirely under prefers-reduced-motion.
 */

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";

// Тот же expo-reveal, что и --ease-out в app/tokens/motion.css.
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

function prefersReduced(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);

/**
 * Dial — configurable circular score gauge (coach hero verdict). The arc is
 * always driven by the raw correctness ratio (floored at 2% so a 0-correct
 * attempt still shows a sliver, per the "diaл-деградация" spec); the centre
 * independently renders either the band (banded attempts) or the plain
 * percentage (non-banded — single passage/part with no band_scale).
 */
export function Dial({
  pct,
  size = 158,
  strokeWidth = 13,
  // Not derived from size/strokeWidth — the source prototype's ring leaves a
  // deliberate ~5.5px breathing margin inside the box (r=67 at size=158),
  // it isn't a tight (size-strokeWidth)/2 fit.
  r = 67,
  center,
}: {
  /** Raw correctness ratio (0..1) driving the arc — independent of what the centre shows. */
  pct: number;
  size?: number;
  strokeWidth?: number;
  r?: number;
  center: { kind: "band"; value: number } | { kind: "pct"; value: number };
}) {
  const c = size / 2;
  const C = 2 * Math.PI * r;
  const p = Math.max(0.02, Math.min(1, pct));
  const finalOffset = C * (1 - p);
  const arcRef = useRef<SVGCircleElement>(null);
  const gradId = useId();

  useEffect(() => {
    if (prefersReduced()) return;
    const arc = arcRef.current;
    if (!arc) return;
    // fill:"backwards" — до старта анимации браузер держит кадр 0 (пустая
    // дуга) сам, минуя вспышку финального состояния перед проигрыванием.
    const anim = arc.animate(
      [{ strokeDashoffset: C }, { strokeDashoffset: finalOffset }],
      { duration: 1100, easing: EASE_OUT, fill: "backwards" },
    );
    return () => anim.cancel();
  }, [C, finalOffset]);

  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block", transform: "rotate(-90deg)" }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-inset)" strokeWidth={strokeWidth} />
        <circle
          ref={arcRef}
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={finalOffset}
        />
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            {/* Литеральные oklch-стопы из прототипа (result-coach.html:250) —
                токены --brand-border/--success дают заметно другой, более
                тусклый вид дуги. */}
            <stop offset="0" stopColor="oklch(0.82 0.16 292)" />
            <stop offset="1" stopColor="oklch(0.86 0.15 156)" />
          </linearGradient>
        </defs>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 44, lineHeight: 1, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
          {center.kind === "band" ? <CountUp value={center.value} decimals={1} /> : <CountUp value={center.value} decimals={0} suffix="%" />}
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginTop: 7 }}>
          {center.kind === "band" ? "Band score" : "Score"}
        </div>
      </div>
    </div>
  );
}

/** Mono count-up. Финал захардкожен в children, JS тикает 0→value. */
export function CountUp({
  value,
  decimals = 0,
  suffix = "",
  durationMs = 1000,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  durationMs?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const final = `${value.toFixed(decimals)}${suffix}`;

  useEffect(() => {
    if (prefersReduced() || !Number.isFinite(value)) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const k = Math.min(1, (now - start) / durationMs);
      el.textContent = `${(easeOutCubic(k) * value).toFixed(decimals)}${suffix}`;
      if (k < 1) raf = requestAnimationFrame(tick);
      else el.textContent = final;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, decimals, suffix, durationMs, final]);

  return (
    <span ref={ref} style={{ fontVariantNumeric: "tabular-nums" }}>
      {final}
    </span>
  );
}

/** Тихий fade-up хвоста после кульминации (Review Room reveal panel и т.п.). */
export function FadeUp({
  children,
  delayMs = 0,
  durationMs = 480,
  style,
}: {
  children: ReactNode;
  delayMs?: number;
  durationMs?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefersReduced()) return;
    const el = ref.current;
    if (!el) return;
    const a = el.animate(
      [
        { opacity: 0, transform: "translateY(10px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: durationMs, delay: delayMs, easing: EASE_OUT, fill: "backwards" },
    );
    return () => a.cancel();
  }, [delayMs, durationMs]);

  return (
    <div ref={ref} style={style}>
      {children}
    </div>
  );
}
