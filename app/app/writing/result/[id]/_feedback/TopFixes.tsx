"use client";

import type { CSSProperties } from "react";

/** Top 3 fixes in priority order — numbered cards. Renders only what exists (1–3). */
export function TopFixes({ fixes }: { fixes: string[] }) {
  return (
    <section>
      <h2 style={S.h2}>Your top fixes</h2>
      <div className="wf-fixgrid" style={S.grid}>
        {fixes.map((fix, i) => (
          <div key={i} style={S.card}>
            <span style={S.num}>{i + 1}</span>
            <p style={S.text}>{fix}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const S: Record<string, CSSProperties> = {
  h2: { margin: "0 0 12px", fontSize: 16, fontWeight: 800, color: "var(--text-primary)" },
  grid: { display: "grid", gap: 12 },
  card: { display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 18 },
  num: { flex: "none", width: 28, height: 28, borderRadius: "var(--radius-full)", background: "var(--brand)", color: "var(--text-on-brand)", fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, display: "grid", placeItems: "center" },
  text: { margin: 0, fontSize: 14.5, lineHeight: 1.5, fontWeight: 500, color: "var(--text-primary)" },
};
