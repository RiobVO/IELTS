"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { CountUp } from "@/components/core/CountUp";

// Эффекты, вредные без мыши/на reduced-motion (tilt, spotlight), включаем только
// на fine-pointer без reduce. CSS-классы этих компонентов живут в DASH_CSS (page.tsx)
// — один источник стилей, без дублей <style> на каждый инстанс.
const canHover = () =>
  window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * HeroMotion — оболочка focus-hero: дрейфующая аврора + свет за курсором + 3D-наклон
 * контента (parallax-глубина). База (тёмный brand-градиент, белый текст, вход
 * dash-rise) приходит классом снаружи и остаётся видимой без JS — эффекты только
 * поверх. Аврора/спот — за контентом (z-index), контраст белого текста держится.
 */
export function HeroMotion({
  children,
  className,
  style,
  max = 5,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const on = useRef(false);
  useEffect(() => {
    on.current = canHover();
  }, []);

  return (
    <div
      ref={ref}
      className={"hero-motion" + (className ? " " + className : "")}
      style={style}
      onPointerMove={(e) => {
        if (!on.current) return;
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(() => {
          el.style.setProperty("--mx", `${(px * 100).toFixed(2)}%`);
          el.style.setProperty("--my", `${(py * 100).toFixed(2)}%`);
          el.style.setProperty("--ry", `${((px - 0.5) * max * 2).toFixed(2)}deg`);
          el.style.setProperty("--rx", `${(-(py - 0.5) * max * 2).toFixed(2)}deg`);
          el.style.setProperty("--spot", "1");
        });
      }}
      onPointerLeave={() => {
        const el = ref.current;
        if (!el) return;
        cancelAnimationFrame(raf.current);
        el.style.setProperty("--ry", "0deg");
        el.style.setProperty("--rx", "0deg");
        el.style.setProperty("--spot", "0");
      }}
    >
      <span aria-hidden="true" className="hero-aurora" />
      <span aria-hidden="true" className="hero-spot" />
      <div className="hero-tilt">{children}</div>
    </div>
  );
}

/**
 * TiltCard — карта целиком наклоняется к курсору (3D). Трансформ на самой карте
 * (у band-gauge нет transform-анимации входа, конфликта нет). Off на тач/
 * reduced-motion — тогда обычная плоская карта.
 */
export function TiltCard({
  children,
  className,
  style,
  max = 6,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const on = useRef(false);
  useEffect(() => {
    on.current = canHover();
  }, []);

  return (
    <div
      ref={ref}
      className={"tilt-card" + (className ? " " + className : "")}
      style={style}
      onPointerMove={(e) => {
        if (!on.current) return;
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(() => {
          el.style.setProperty("--ry", `${(px * max * 2).toFixed(2)}deg`);
          el.style.setProperty("--rx", `${(-py * max * 2).toFixed(2)}deg`);
        });
      }}
      onPointerLeave={() => {
        const el = ref.current;
        if (!el) return;
        cancelAnimationFrame(raf.current);
        el.style.setProperty("--ry", "0deg");
        el.style.setProperty("--rx", "0deg");
      }}
    >
      {children}
    </div>
  );
}

// Геометрия gauge. pathLength=100 нормирует длину кольца → 75 ед. = 270° дуга,
// 25 ед. — разрыв внизу; поворот на 135° ставит разрыв по центру низа.
const SIZE = 150;
const STROKE = 13;
const CX = SIZE / 2;
const R = SIZE / 2 - STROKE / 2 - 4;
const SWEEP_UNITS = 75; // 270° в единицах pathLength
const START_DEG = 135;

/**
 * BandGauge — band как рисующаяся круговая дуга (270°) с набегающей цифрой в центре
 * и отметкой target. Заполненное состояние band-ридаута; пустые состояния остаются
 * серверными в page.tsx. Дуга дорисовывается от 0 к band; reduced-motion → сразу
 * финал (base stroke-dashoffset:0). SVG декоративен (aria-hidden) — смысл несёт
 * подпись и текст в центре.
 */
export function BandGauge({
  band,
  target,
  source,
  caption,
  reached,
  low,
  ariaLabel,
}: {
  band: number;
  target: number | null;
  source: string | null;
  caption: string;
  reached: boolean;
  low: boolean;
  ariaLabel: string;
}) {
  const frac = Math.max(0, Math.min(1, band / 9));
  const valLen = +(frac * SWEEP_UNITS).toFixed(2);
  const dec = Number.isInteger(band) ? 0 : 1;

  let tick: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (target != null) {
    const ft = Math.max(0, Math.min(1, target / 9));
    const a = ((START_DEG + ft * 270) * Math.PI) / 180;
    const r1 = R - STROKE / 2 - 2;
    const r2 = R + STROKE / 2 + 2;
    tick = {
      x1: CX + Math.cos(a) * r1,
      y1: CX + Math.sin(a) * r1,
      x2: CX + Math.cos(a) * r2,
      y2: CX + Math.sin(a) * r2,
    };
  }

  return (
    // role=img + aria-label — единый SR-ридаут (band/target/next stop); внутренности
    // трактуются AT как одно изображение, декоративный SVG уже aria-hidden.
    <div className="gauge-wrap" role="img" aria-label={ariaLabel}>
      <div className="gauge-label">Your band</div>
      <div className="gauge-stage" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <defs>
            <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--brand-active)" />
              <stop offset="1" stopColor="var(--brand)" />
            </linearGradient>
          </defs>
          <circle
            cx={CX}
            cy={CX}
            r={R}
            pathLength={100}
            fill="none"
            stroke="var(--surface-inset)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${SWEEP_UNITS} ${100 - SWEEP_UNITS}`}
            transform={`rotate(${START_DEG} ${CX} ${CX})`}
          />
          <circle
            className="gauge-val"
            cx={CX}
            cy={CX}
            r={R}
            pathLength={100}
            fill="none"
            stroke="url(#gaugeGrad)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${valLen} 100`}
            transform={`rotate(${START_DEG} ${CX} ${CX})`}
            style={{ "--val-len": String(valLen) } as CSSProperties}
          />
          {tick && (
            <line
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              stroke="var(--text-primary)"
              strokeWidth={3}
              strokeLinecap="round"
            />
          )}
        </svg>
        <div className="gauge-center">
          <span title={source ? `From ${source}` : undefined}>
            <CountUp value={band} decimals={dec} className={low ? "gauge-num gauge-num-low" : "gauge-num"} />
          </span>
          <span className="gauge-sub">{target != null ? `/ ${target}` : "out of 9"}</span>
        </div>
      </div>
      <div className="gauge-caption" style={{ color: reached ? "var(--success-text)" : "var(--brand-active)" }}>
        {caption}
      </div>
    </div>
  );
}
