"use client";

/**
 * Result band reveal — единственный кинематографичный момент отчёта (overdrive).
 * Кульминация продукта «Stop guessing your band»: при открытии отчёта дуга donut
 * прорисовывается, band-число тикает вверх, accuracy-бары вырастают каскадом
 * worst-first, рекомендация всплывает следом.
 *
 * Инвариант: финальное состояние захардкожено в разметке (SSR/без-JS видят его
 * сразу). Анимация — только WAAPI/rAF поверх уже-видимого дефолта; при
 * prefers-reduced-motion ничего не проигрывается. Никакой контент не гейтится
 * классом-триггером (overdrive: reveal enhances an already-visible default).
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

// Тот же expo-reveal, что и --ease-out в app/tokens/motion.css.
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

function prefersReduced(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);

/** Donut — дуга рисуется 0→pct, % в центре тикает синхронно под одним rAF. */
export function AnimatedDonut({ pct }: { pct: number }) {
  const size = 120;
  const sw = 18;
  const r = (size - sw) / 2;
  const cx = size / 2;
  const C = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  const finalOffset = C * (1 - p);
  const arcRef = useRef<SVGCircleElement>(null);
  const txtRef = useRef<SVGTextElement>(null);

  useEffect(() => {
    if (prefersReduced()) return;
    const arc = arcRef.current;
    if (!arc) return;
    const dur = 1000;
    // fill:"backwards" — кадр 0 (пустая дуга) показывается с t0, без вспышки.
    const anim = arc.animate(
      [{ strokeDashoffset: C }, { strokeDashoffset: finalOffset }],
      { duration: dur, easing: EASE_OUT, fill: "backwards" },
    );
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const k = Math.min(1, (now - start) / dur);
      if (txtRef.current) {
        txtRef.current.textContent = `${Math.round(easeOutCubic(k) * p * 100)}%`;
      }
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      anim.cancel();
    };
  }, [C, finalOffset, p]);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: "none" }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--error-subtle)" strokeWidth={sw} />
      <circle
        ref={arcRef}
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke="var(--success)"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={finalOffset}
        transform={`rotate(-90 ${cx} ${cx})`}
      />
      <text ref={txtRef} x={cx} y={cx - 2} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="26" fontWeight="600" fill="var(--text-primary)">
        {Math.round(p * 100)}%
      </text>
      <text x={cx} y={cx + 16} textAnchor="middle" fontFamily="var(--font-ui)" fontSize="10" fontWeight="600" fill="var(--text-muted)">
        correct
      </text>
    </svg>
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

/** Тихий fade-up хвоста (рекомендация) после кульминации. */
export function FadeUp({
  children,
  delayMs = 0,
  style,
}: {
  children: ReactNode;
  delayMs?: number;
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
      { duration: 480, delay: delayMs, easing: EASE_OUT, fill: "backwards" },
    );
    return () => a.cancel();
  }, [delayMs]);

  return (
    <div ref={ref} style={style}>
      {children}
    </div>
  );
}
