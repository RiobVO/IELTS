"use client";

import type { CSSProperties } from "react";
import { buildAnnotationSegments } from "@/lib/writing/feedback-view";

export interface RewriteMove {
  quote: string;
  label: string;
}
export interface RewriteData {
  thesisOld: string;
  thesis: string;
  paragraph: string;
  replacements: { from: string; to: string }[];
  // Optional "delta & technique" extras — present only on evals produced after the
  // prompt emits them; every block below degrades gracefully when absent.
  thesisMoves?: RewriteMove[];
  paragraphMoves?: string[];
  paragraphOld?: string;
}

// Move highlight/chip palette — cycled by index so the <mark> tint and its chip dot
// always match. Gold → green → violet (uses the same semantic tokens as the rest of
// the feedback surface; no new colors).
const MOVE_TONES = [
  { accent: "var(--warn-text)", tint: "var(--warn-subtle)" },
  { accent: "var(--success-text)", tint: "var(--success-subtle)" },
  { accent: "var(--brand)", tint: "var(--brand-subtle)" },
];
const tone = (i: number) => MOVE_TONES[i % MOVE_TONES.length];

/** A partial rewrite to learn from — stronger thesis, one paragraph, weak-phrase swaps. */
export function Rewrite({ rewrite }: { rewrite: RewriteData }) {
  const moves = rewrite.thesisMoves ?? [];
  // Highlight the technique spans inside the stronger thesis; a quote not found is
  // skipped by the helper, so its chip still shows below — just without a highlight.
  const thesisSegments = moves.length
    ? buildAnnotationSegments(rewrite.thesis, moves.map((m) => m.quote))
    : null;

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
          <p style={S.stronger}>
            {thesisSegments
              ? thesisSegments.map((seg, i) =>
                  seg.annIndex === null ? (
                    <span key={i}>{seg.text}</span>
                  ) : (
                    <mark
                      key={i}
                      style={{
                        background: tone(seg.annIndex).tint,
                        color: "inherit",
                        boxShadow: `inset 0 -2px 0 ${tone(seg.annIndex).accent}`,
                        borderRadius: 4,
                        padding: "0 2px",
                      }}
                    >
                      {seg.text}
                    </mark>
                  ),
                )
              : rewrite.thesis}
          </p>
          {moves.length > 0 && (
            <div style={S.moves}>
              {moves.map((m, i) => (
                <span key={i} style={S.move}>
                  <span style={{ ...S.moveDot, background: tone(i).accent }} />
                  {m.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 2. One rewritten paragraph */}
        <div style={S.card}>
          <div style={S.cardTitle}>One rewritten paragraph</div>
          {rewrite.paragraphMoves && rewrite.paragraphMoves.length > 0 && (
            <div style={{ ...S.moves, marginBottom: 12, marginTop: 0 }}>
              {rewrite.paragraphMoves.map((label, i) => (
                <span key={i} style={S.move}>
                  <span style={{ ...S.moveDot, background: tone(i).accent }} />
                  {label}
                </span>
              ))}
            </div>
          )}
          <p style={S.para}>{rewrite.paragraph}</p>
          {rewrite.paragraphOld && (
            <details style={S.orig}>
              <summary style={S.origSummary}>Show your original</summary>
              <p style={S.origText}>{rewrite.paragraphOld}</p>
            </details>
          )}
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
  // No strikethrough: the original is a baseline to compare against, not an error to
  // cross out — striking a perfectly fine sentence reads as "all wrong" and demotivates.
  yours: { margin: "0 0 14px", fontFamily: "var(--font-reading)", fontSize: 15, lineHeight: 1.55, color: "var(--text-muted)" },
  strongerLabel: { fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-link)", marginBottom: 4 },
  stronger: { margin: 0, fontFamily: "var(--font-reading)", fontSize: 15.5, lineHeight: 1.6, color: "var(--text-primary)", background: "var(--brand-subtle)", border: "1px solid var(--brand-border)", borderRadius: "var(--radius-md)", padding: "12px 14px" },

  // Technique chips — what changed and why, so the rewrite teaches the move, not just
  // the result. Reused above the paragraph (labels only) and below the thesis.
  moves: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 },
  move: { display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", background: "var(--surface-inset)", border: "1px solid var(--border-subtle)", padding: "5px 11px", borderRadius: "var(--radius-full)" },
  moveDot: { width: 8, height: 8, borderRadius: "var(--radius-full)", flex: "none" },

  para: { margin: 0, fontFamily: "var(--font-reading)", fontSize: 15.5, lineHeight: 1.7, color: "var(--reading-text)", background: "var(--reading-surface)", borderRadius: "var(--radius-md)", padding: "14px 16px" },

  orig: { marginTop: 12, borderTop: "1px dashed var(--border)", paddingTop: 10 },
  origSummary: { cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "var(--text-link)", listStyle: "none" },
  origText: { margin: "10px 0 0", fontFamily: "var(--font-reading)", fontSize: 14.5, lineHeight: 1.65, color: "var(--text-muted)" },

  chips: { display: "flex", flexWrap: "wrap", gap: 10 },
  chip: { display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: "var(--radius-full)", background: "var(--surface-inset)", fontSize: 13.5 },
  from: { color: "var(--text-muted)", textDecoration: "line-through" },
  arrow: { color: "var(--text-disabled)" },
  to: { color: "var(--success-text)", fontWeight: 600 },
};
