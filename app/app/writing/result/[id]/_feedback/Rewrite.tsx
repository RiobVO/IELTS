"use client";

import type { CSSProperties } from "react";

export interface RewriteData {
  thesisOld: string;
  thesis: string;
  paragraph: string;
  replacements: { from: string; to: string }[];
}

/** A partial rewrite to learn from — stronger thesis, one paragraph, weak-phrase swaps. */
export function Rewrite({ rewrite }: { rewrite: RewriteData }) {
  return (
    <section>
      <h2 style={S.h2}>A partial rewrite to learn from</h2>
      <div style={S.stack}>
        {/* 1. Stronger thesis */}
        <div style={S.card}>
          <div style={S.cardTitle}>Stronger thesis</div>
          <div style={S.yoursLabel}>Yours</div>
          <p style={S.yours}>{rewrite.thesisOld}</p>
          <div style={S.strongerLabel}>Stronger</div>
          <p style={S.stronger}>{rewrite.thesis}</p>
        </div>

        {/* 2. One rewritten paragraph */}
        <div style={S.card}>
          <div style={S.cardTitle}>One rewritten paragraph</div>
          <p style={S.para}>{rewrite.paragraph}</p>
        </div>

        {/* 3. Swap weak phrases */}
        {rewrite.replacements.length > 0 && (
          <div style={S.card}>
            <div style={S.cardTitle}>Swap these weak phrases</div>
            <div style={S.chips}>
              {rewrite.replacements.map((r, i) => (
                <span key={i} style={S.chip}>
                  <span style={S.from}>{r.from}</span>
                  <span style={S.arrow}>→</span>
                  <span style={S.to}>{r.to}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

const S: Record<string, CSSProperties> = {
  h2: { margin: "0 0 12px", fontSize: 16, fontWeight: 800, color: "var(--text-primary)" },
  stack: { display: "flex", flexDirection: "column", gap: 12 },
  card: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 18 },
  cardTitle: { fontSize: 13, fontWeight: 800, color: "var(--text-primary)", marginBottom: 12 },

  yoursLabel: { fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 },
  yours: { margin: "0 0 14px", fontFamily: "var(--font-reading)", fontSize: 15, lineHeight: 1.55, color: "var(--text-muted)", textDecoration: "line-through", textDecorationColor: "var(--error)" },
  strongerLabel: { fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-link)", marginBottom: 4 },
  stronger: { margin: 0, fontFamily: "var(--font-reading)", fontSize: 15.5, lineHeight: 1.6, color: "var(--text-primary)", background: "var(--brand-subtle)", border: "1px solid var(--brand-border)", borderRadius: "var(--radius-md)", padding: "12px 14px" },

  para: { margin: 0, fontFamily: "var(--font-reading)", fontSize: 15.5, lineHeight: 1.7, color: "var(--reading-text)", background: "var(--reading-surface)", borderRadius: "var(--radius-md)", padding: "14px 16px" },

  chips: { display: "flex", flexWrap: "wrap", gap: 10 },
  chip: { display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: "var(--radius-full)", background: "var(--surface-inset)", fontSize: 13.5 },
  from: { color: "var(--text-muted)", textDecoration: "line-through" },
  arrow: { color: "var(--text-disabled)" },
  to: { color: "var(--success-text)", fontWeight: 600 },
};
