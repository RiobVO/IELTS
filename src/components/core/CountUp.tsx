"use client";

import { useEffect, useState, type CSSProperties } from "react";

/**
 * CountUp — число «набегает» 0→value на маунте (rAF, ease-out-cubic). SSR и
 * prefers-reduced-motion рендерят сразу финал (контент не пустой без JS и не
 * дёргается для тех, кто просил без движения). Реанимирует только при смене value,
 * поэтому в клиентской навигации не пересчитывается зря.
 */
export function CountUp({
  value,
  decimals = 0,
  locale = false,
  duration = 950,
  className,
  style,
}: {
  value: number;
  decimals?: number;
  /** Форматировать разделителями тысяч (для XP и т.п.). */
  locale?: boolean;
  duration?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const [n, setN] = useState(value);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(value);
      return;
    }
    let raf = 0;
    let t0 = 0;
    const step = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out-cubic
      setN(value * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else setN(value);
    };
    setN(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const text = locale ? Math.round(n).toLocaleString("en-US") : n.toFixed(decimals);
  return (
    <span className={className} style={style}>
      {text}
    </span>
  );
}
