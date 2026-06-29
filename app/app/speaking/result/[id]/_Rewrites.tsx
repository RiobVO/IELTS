import type { CSSProperties } from "react";

/**
 * "Say it stronger" (#1) — 2–3 of the candidate's OWN lines rephrased to band 7–8 by the
 * evaluator (mirrors the Writing "rewrite delta"). Each pair shows their words (muted,
 * dashed) above the upgrade (success-tinted), turning critique into a model to imitate.
 * Presentational only; the block is hidden when there's nothing to rewrite (short /
 * no-speech answer, or after a user delete wiped the verbatim lines).
 */
export interface Rewrite {
  original: string;
  improved: string;
}

export function Rewrites({ rewrites }: { rewrites: Rewrite[] }) {
  if (rewrites.length === 0) return null;

  return (
    <section>
      <div style={S.head}>
        <h2 style={S.h2}>Say it stronger</h2>
        <span style={S.pill}>Band 7+</span>
      </div>
      <p style={S.help}>
        A few of your own lines, rephrased the way a band 7+ speaker would — keep the meaning, borrow the upgrade next time.
      </p>

      <div style={S.list}>
        {rewrites.map((r, i) => (
          <div key={i} style={S.pair}>
            <div style={S.yours}>
              <span style={{ ...S.tag, ...S.tagY }}>Yours</span>
              <span style={S.yoursText}>{r.original}</span>
            </div>
            <div style={S.strong}>
              <span style={{ ...S.tag, ...S.tagS }}>Stronger</span>
              <span style={S.strongText}>{r.improved}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

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
  tag: { display: "inline-block", fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 7px", borderRadius: "var(--radius-full)", marginRight: 8, verticalAlign: "middle" },
  tagY: { background: "var(--surface-inset)", color: "var(--text-muted)" },
  tagS: { background: "var(--success)", color: "#fff" },
};
