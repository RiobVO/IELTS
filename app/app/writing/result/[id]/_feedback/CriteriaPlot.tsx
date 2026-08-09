"use client";

import type { CSSProperties } from "react";
import { Icon } from "@/components/core/icons";
import { axisPct, gapToTarget } from "./util";

export interface PlotRow {
  label: string;
  bandLow: number;
  bandHigh: number;
  strength: string;
  mainIssue: string;
  nextStep: string;
  isBlocker: boolean;
}

const TICKS = [5, 6, 7, 8];

/**
 * The four IELTS criteria as confidence-interval markers on a shared 4.0–9.0 axis,
 * weakest first. Each right cell draws the band range as a segment with ring
 * endpoints and a dashed target line — a static marker, NOT an interactive slider.
 */
export function CriteriaPlot({ rows, targetBand }: { rows: PlotRow[]; targetBand: number }) {
  const targetLeft = axisPct(targetBand);
  // Anchor the TARGET label so it never clips at the panel's right edge, and drop any
  // axis tick that would collide with it (e.g. tick 9 sitting under TARGET 9).
  const targetAnchor = targetLeft >= 90 ? "translateX(-100%)" : targetLeft <= 10 ? "translateX(0)" : "translateX(-50%)";
  const ticks = TICKS.filter((t) => Math.abs(axisPct(t) - targetLeft) > 7);
  return (
    <section>
      <div style={S.headRow}>
        <h2 style={S.h2}>The four IELTS criteria</h2>
        <span style={S.weakest}>Weakest first</span>
      </div>
      <div style={S.panel}>
        {/* Header strip with axis */}
        <div className="wf-plotrow" style={S.strip}>
          <div style={S.stripLabel}>Criterion · estimated range</div>
          <div style={S.axis}>
            {ticks.map((t) => (
              <span key={t} className="wf-plot-tick" style={{ ...S.tick, left: `${axisPct(t)}%` }}>
                {t}
              </span>
            ))}
            <span className="wf-plot-targetmark" style={{ ...S.targetMark, left: `${targetLeft}%`, transform: targetAnchor }}>TARGET {targetBand.toFixed(1)}</span>
          </div>
        </div>

        {rows.map((r, i) => (
          <div key={i} className="wf-plotrow" style={{ ...S.row, ...(r.isBlocker ? S.rowBlocker : null) }}>
            <div>
              <div style={S.rowTop}>
                <span style={S.rank}>{i + 1}</span>
                <span style={S.critName}>{r.label}</span>
                {r.isBlocker && (
                  <span style={S.fixFirst}>
                    <Icon name="alert-triangle" size={12} strokeWidth={2.4} /> Fix first
                  </span>
                )}
                <span style={S.range}>
                  {r.bandLow.toFixed(1)}–{r.bandHigh.toFixed(1)}
                </span>
              </div>
              <div style={S.detail}>
                <Line label="Strength" value={r.strength} labelColor="var(--text-disabled)" />
                <Line label="Watch" value={r.mainIssue} labelColor="var(--text-disabled)" />
                <Line label="Next" value={r.nextStep} labelColor="var(--text-link)" valueColor="var(--text-primary)" />
              </div>
            </div>

            <Marker low={r.bandLow} high={r.bandHigh} targetLeft={targetLeft} gap={gapToTarget(r.bandHigh, targetBand)} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Line({ label, value, labelColor, valueColor = "var(--text-secondary)" }: { label: string; value: string; labelColor: string; valueColor?: string }) {
  return (
    <div style={S.line}>
      <span className="wf-plot-linelabel" style={{ ...S.lineLabel, color: labelColor }}>{label}</span>
      <span style={{ ...S.lineValue, color: valueColor, fontWeight: label === "Next" ? 500 : 400 }}>{value}</span>
    </div>
  );
}

function Marker({ low, high, targetLeft, gap }: { low: number; high: number; targetLeft: number; gap: string }) {
  const a = axisPct(low);
  const b = axisPct(high);
  return (
    <div style={S.markerCell}>
      <span style={S.gapCaption}>{gap}</span>
      <div style={S.markerTrack}>
        <span style={S.rail} />
        <span style={{ ...S.segment, left: `${a}%`, width: `${Math.max(0, b - a)}%` }} />
        <span style={{ ...S.endpoint, left: `${a}%` }} />
        <span style={{ ...S.endpoint, left: `${b}%` }} />
        <span style={{ ...S.targetLine, left: `${targetLeft}%` }} />
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  headRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 },
  h2: { margin: 0, fontSize: 16, fontWeight: 800, color: "var(--text-primary)" },
  weakest: { fontSize: 12, fontWeight: 700, color: "var(--text-muted)" },

  panel: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: 20, boxShadow: "var(--shadow-solid)", overflow: "hidden" },
  strip: { background: "var(--surface-inset)", padding: "12px 20px", display: "grid", gap: 16, alignItems: "center" },
  stripLabel: { fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" },
  axis: { position: "relative", height: 18 },
  tick: { position: "absolute", top: 0, transform: "translateX(-50%)", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-disabled)" },
  targetMark: { position: "absolute", top: 0, transform: "translateX(-50%)", fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", color: "var(--text-link)", whiteSpace: "nowrap" },

  row: { padding: "18px 20px", display: "grid", gap: 16, alignItems: "center", borderTop: "1px solid var(--border-subtle)" },
  rowBlocker: { background: "var(--surface-inset)" },
  rowTop: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  rank: { flex: "none", width: 24, height: 24, borderRadius: 7, background: "var(--surface-inset)", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, display: "grid", placeItems: "center" },
  critName: { fontFamily: "var(--font-reading)", fontSize: 17, fontWeight: 600, color: "var(--text-primary)" },
  fixFirst: { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: "var(--radius-full)", background: "var(--error-subtle)", color: "var(--error-text)", fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase" },
  range: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 800, color: "var(--text-primary)" },
  detail: { marginTop: 10, marginLeft: 35, display: "flex", flexDirection: "column", gap: 5 },
  line: { display: "flex", gap: 10, alignItems: "baseline" },
  lineLabel: { flex: "none", width: 64, fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" },
  lineValue: { fontSize: 13.5, lineHeight: 1.45 },

  markerCell: { position: "relative", paddingTop: 14 },
  gapCaption: { position: "absolute", top: 0, right: 0, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" },
  markerTrack: { position: "relative", height: 22 },
  rail: { position: "absolute", top: "50%", left: 0, right: 0, height: 10, transform: "translateY(-50%)", background: "var(--surface-inset)", borderRadius: "var(--radius-full)" },
  segment: { position: "absolute", top: "50%", height: 10, transform: "translateY(-50%)", background: "var(--slate-700)", borderRadius: "var(--radius-full)", boxShadow: "var(--shadow-solid)" },
  endpoint: { position: "absolute", top: "50%", width: 13, height: 13, transform: "translate(-50%, -50%)", background: "var(--surface)", border: "3px solid var(--slate-700)", borderRadius: "var(--radius-full)" },
  targetLine: { position: "absolute", top: -4, bottom: -4, width: 0, borderLeft: "2px dashed var(--brand-border)" },
};
