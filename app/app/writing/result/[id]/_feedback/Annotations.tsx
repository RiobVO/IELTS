"use client";

import { useState, type CSSProperties } from "react";
import { buildAnnotationSegments } from "@/lib/writing/feedback-view";
import { TYPE_STYLE, type AnnoType } from "./util";

export interface Anno {
  quote: string;
  comment: string;
  type: AnnoType;
}

/**
 * Notes on your text — the essay rendered with annotated phrases as <mark>, plus a
 * comment card per annotation. Highlights and cards are bidirectionally linked by
 * index: clicking either sets the active note (ring + tint).
 */
export function Annotations({ essay, annotations }: { essay: string; annotations: Anno[] }) {
  const [active, setActive] = useState<number | null>(null);
  const segments = buildAnnotationSegments(essay, annotations.map((a) => a.quote));

  return (
    <section>
      <style>{CSS}</style>
      <h2 style={S.h2}>Notes on your text</h2>
      <p style={S.help}>Tap a highlight or a card — they&apos;re linked. Colour shows the kind of note.</p>
      <div style={S.legend}>
        {(["good", "style", "grammar"] as AnnoType[]).map((t) => (
          <span key={t} style={S.legendItem}>
            <span style={{ ...S.legendDot, background: TYPE_STYLE[t].accent }} />
            {TYPE_STYLE[t].legend}
          </span>
        ))}
      </div>

      <div className="wf-annogrid" style={S.grid}>
        <div style={S.essay}>
          {segments.map((seg, i) => {
            if (seg.annIndex === null) return <span key={i}>{seg.text}</span>;
            const a = annotations[seg.annIndex];
            const ts = TYPE_STYLE[a.type];
            const on = active === seg.annIndex;
            return (
              <mark
                key={i}
                onClick={() => setActive(seg.annIndex)}
                style={{
                  background: ts.tint,
                  color: "inherit",
                  borderBottom: `2px solid ${ts.accent}`,
                  borderRadius: 3,
                  padding: "0 1px",
                  cursor: "pointer",
                  boxShadow: on ? `0 0 0 2px ${ts.accent}` : "none",
                }}
              >
                {seg.text}
              </mark>
            );
          })}
        </div>

        <div style={S.cards}>
          {annotations.map((a, i) => {
            const ts = TYPE_STYLE[a.type];
            const on = active === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setActive(i)}
                className={on ? "wf-cardactive" : undefined}
                style={{
                  ...S.card,
                  borderLeft: `3px solid ${ts.accent}`,
                  background: on ? ts.tint : "var(--surface)",
                }}
              >
                <span style={{ ...S.cardType, color: ts.accent }}>{ts.label}</span>
                <span style={S.cardQuote}>“{a.quote}”</span>
                <span style={S.cardComment}>{a.comment}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const CSS = `
@keyframes wf-ring{0%{box-shadow:0 0 0 0 var(--brand)}100%{box-shadow:0 0 0 7px transparent}}
.wf-cardactive{animation:wf-ring .5s var(--ease-out)}
@media (prefers-reduced-motion:reduce){.wf-cardactive{animation:none!important}}
`;

const S: Record<string, CSSProperties> = {
  h2: { margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: "var(--text-primary)" },
  help: { margin: "0 0 12px", fontSize: 13.5, color: "var(--text-muted)" },
  legend: { display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 14 },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" },
  legendDot: { width: 12, height: 4, borderRadius: "var(--radius-full)" },

  grid: { display: "grid", gap: 16, alignItems: "start" },
  essay: { background: "var(--reading-surface)", color: "var(--reading-text)", fontFamily: "var(--font-reading)", fontSize: 16, lineHeight: 1.95, whiteSpace: "pre-wrap", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 22px" },
  cards: { display: "flex", flexDirection: "column", gap: 10 },
  card: { display: "flex", flexDirection: "column", gap: 5, textAlign: "left", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px", cursor: "pointer", fontFamily: "var(--font-ui)", transition: "background-color var(--duration-fast) var(--ease-standard)" },
  cardType: { fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" },
  cardQuote: { fontFamily: "var(--font-reading)", fontStyle: "italic", fontSize: 13.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cardComment: { fontSize: 13.5, lineHeight: 1.5, color: "var(--text-primary)" },
};
