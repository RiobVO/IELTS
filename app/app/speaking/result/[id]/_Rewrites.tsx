import type { CSSProperties, ReactNode } from "react";
import { buildAnnotationSegments } from "@/lib/writing/feedback-view";

/**
 * "Say it stronger" (#1) — 2–3 of the candidate's OWN lines rephrased to band 7–8 by the
 * evaluator (mirrors the Writing "rewrite delta"). Each pair shows their words (muted,
 * dashed) above the upgrade (success-tinted), turning critique into a model to imitate.
 * When the model supplies phrase-level `replacements`, the changed words are struck through
 * in "Yours" and green-highlighted in "Stronger" (an inline diff). Legacy rows without
 * replacements render the plain lines. Presentational only; the block is hidden when there's
 * nothing to rewrite (short / no-speech answer, or after a user delete wiped the lines).
 */
export interface Rewrite {
  original: string;
  improved: string;
  replacements?: { from: string; to: string }[];
}

// Wrap each matched phrase (located first-match, non-overlapping by buildAnnotationSegments)
// in the given style; unmatched text stays plain. No phrases → the raw string.
function diffHighlight(text: string, phrases: string[], matchStyle: CSSProperties): ReactNode {
  if (phrases.length === 0) return text;
  const segs = buildAnnotationSegments(text, phrases);
  return segs.map((s, i) =>
    s.annIndex === null
      ? <span key={i}>{s.text}</span>
      : <span key={i} style={matchStyle}>{s.text}</span>,
  );
}

export function Rewrites({ rewrites }: { rewrites: Rewrite[] }) {
  if (rewrites.length === 0) return null;

  return (
    <section>
      <style>{CSS}</style>
      <div style={S.head}>
        <h2 style={S.h2}>Say it stronger</h2>
        <span style={S.pill}>Band 7+</span>
      </div>
      <p style={S.help}>
        A few of your own lines, rephrased the way a band 7+ speaker would — keep the meaning, borrow the upgrade next time.
      </p>

      <div style={S.list}>
        {rewrites.map((r, i) => {
          const reps = r.replacements ?? [];
          return (
            <div key={i} style={S.pair}>
              <div style={S.yours}>
                <span className="sr-rw-tag" style={{ ...S.tag, ...S.tagY }}>Yours</span>
                <span style={S.yoursText}>{diffHighlight(r.original, reps.map((p) => p.from), S.strike)}</span>
              </div>
              <div style={S.strong}>
                <span className="sr-rw-tag" style={{ ...S.tag, ...S.tagS }}>Stronger</span>
                <span style={S.strongText}>{diffHighlight(r.improved, reps.map((p) => p.to), S.up)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// "Yours"/"Stronger" — смысловые uppercase-теги, поднимаем до 12px на узком экране.
const CSS = `
@media (max-width:430px){
  .sr-rw-tag{font-size:12px!important}
}
`;

const S: Record<string, CSSProperties> = {
  head: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 },
  h2: { margin: 0, fontSize: 16, fontWeight: 800, color: "var(--text-primary)" },
  pill: { fontSize: 11, fontWeight: 700, color: "var(--success-text)", background: "var(--success-subtle)", padding: "2px 9px", borderRadius: "var(--radius-full)" },
  help: { margin: "0 0 14px", fontSize: 13.5, color: "var(--text-muted)" },

  list: { display: "flex", flexDirection: "column", gap: 12 },
  pair: { border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" },
  row: { padding: "12px 15px", fontSize: 14, lineHeight: 1.55 },
  yours: { padding: "12px 15px", fontSize: 14, lineHeight: 1.55, background: "var(--surface)", color: "var(--text-secondary)", borderBottom: "1px dashed var(--border-strong)" },
  strong: { padding: "12px 15px", fontSize: 14, lineHeight: 1.55, background: "color-mix(in oklab, var(--success-subtle) 60%, var(--surface))" },
  yoursText: { fontFamily: "var(--font-reading)" },
  strongText: { fontFamily: "var(--font-reading)", color: "var(--text-primary)", fontWeight: 500 },
  strike: { color: "var(--text-muted)", textDecorationLine: "line-through", textDecorationColor: "var(--error-text)", textDecorationThickness: 2 },
  up: { background: "color-mix(in oklab, var(--success) 22%, transparent)", color: "var(--success-text)", fontWeight: 700, borderRadius: 4, padding: "0 3px" },
  tag: { display: "inline-block", fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 7px", borderRadius: "var(--radius-full)", marginRight: 8, verticalAlign: "middle" },
  tagY: { background: "var(--surface-inset)", color: "var(--text-muted)" },
  tagS: { background: "var(--success)", color: "#fff" },
};
