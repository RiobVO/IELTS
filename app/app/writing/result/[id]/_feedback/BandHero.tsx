"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { confidencePills, confidenceLabelFor } from "./util";

/**
 * BandHero — estimated range + confidence on the left, the single biggest blocker
 * on the right. The low band number counts up from (low − 0.8) on enter, snapping
 * to final under prefers-reduced-motion.
 */
export function BandHero({
  bandLow,
  bandHigh,
  confidence,
  blockerName,
  blockerNote,
}: {
  bandLow: number;
  bandHigh: number;
  confidence: "low" | "medium" | "high";
  blockerName: string;
  blockerNote: string;
}) {
  const filled = confidencePills(confidence);
  return (
    <div className="wf-herogrid" style={S.grid}>
      <div style={S.left}>
        <div style={S.overline}>Estimated band</div>
        <div style={S.bandLine}>
          <span style={S.bandLow}>
            <BandNumber value={bandLow} />
          </span>
          <span style={S.bandHigh}>–{bandHigh.toFixed(1)}</span>
        </div>
        <div style={S.confRow}>
          <div style={S.pills} aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ ...S.pill, background: i < filled ? "var(--brand)" : "var(--brand-border)" }} />
            ))}
          </div>
          <span style={S.confWord}>{confidenceLabelFor(confidence)} confidence</span>
        </div>
        <p style={S.disclaimer}>
          A coaching estimate to guide practice — <b style={{ color: "var(--text-primary)" }}>not an official IELTS score.</b>
        </p>
      </div>

      <div style={S.right}>
        <span style={S.blockerBadge}>Biggest blocker</span>
        <div style={S.blockerName}>{blockerName}</div>
        <p style={S.blockerNote}>{blockerNote}</p>
        <p style={S.blockerCta}>Fix this one first — it moves your band the most.</p>
      </div>
    </div>
  );
}

function BandNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;
    const dur = 950;
    const from = Math.max(0, value - 0.8);
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = (from + (value - from) * e).toFixed(1);
      if (k < 1) raf = requestAnimationFrame(tick);
      else el.textContent = value.toFixed(1);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span ref={ref} style={{ fontVariantNumeric: "tabular-nums" }}>
      {value.toFixed(1)}
    </span>
  );
}

const S: Record<string, CSSProperties> = {
  grid: { display: "grid", border: "1px solid var(--brand-border)", borderRadius: "var(--radius-2xl)", boxShadow: "var(--shadow-solid-lg)", overflow: "hidden" },
  left: { background: "var(--brand-subtle)", padding: 26 },
  overline: { fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-link)" },
  bandLine: { display: "flex", alignItems: "baseline", gap: 4, marginTop: 8 },
  bandLow: { fontFamily: "var(--font-mono)", fontSize: 60, fontWeight: 800, lineHeight: 1, color: "var(--text-primary)", letterSpacing: "-0.02em" },
  bandHigh: { fontFamily: "var(--font-mono)", fontSize: 30, fontWeight: 700, color: "var(--text-secondary)" },
  confRow: { display: "flex", alignItems: "center", gap: 10, marginTop: 16 },
  pills: { display: "flex", gap: 5 },
  pill: { width: 22, height: 7, borderRadius: "var(--radius-full)" },
  confWord: { fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" },
  disclaimer: { margin: "16px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" },

  right: { background: "var(--surface)", borderLeft: "4px solid var(--error)", padding: 26 },
  blockerBadge: { display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: "var(--radius-full)", background: "var(--error-subtle)", color: "var(--error-text)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" },
  blockerName: { fontFamily: "var(--font-reading)", fontSize: 21, fontWeight: 700, color: "var(--text-primary)", marginTop: 12 },
  blockerNote: { margin: "8px 0 0", fontSize: 16, lineHeight: 1.5, color: "var(--text-secondary)" },
  blockerCta: { margin: "14px 0 0", fontSize: 14, fontWeight: 600, color: "var(--text-link)" },
};
