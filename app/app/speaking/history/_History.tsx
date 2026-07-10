"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import { confidenceLabel } from "@/lib/speaking/labels";
import type { SpeakingHistoryRow } from "@/lib/speaking/read";
import { deleteSpeakingRecording } from "../actions";

/**
 * Speaking history grid. Client island so the per-row "delete recording" control can
 * call the server action and optimistically flip the row to "recording deleted" — the
 * snapshot (band + feedback) stays, only audio + transcript go. Mirrors the Writing
 * history card styling; band chip carries the level colour.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;

type BandLevel = "hi" | "mid" | "low" | "vlow";
function bandLevel(low: number, high: number): BandLevel {
  const mid = (low + high) / 2;
  if (mid >= 7) return "hi";
  if (mid >= 6) return "mid";
  if (mid >= 5) return "low";
  return "vlow";
}
const BAND_TONE: Record<BandLevel, CSSProperties> = {
  hi: { background: "var(--success-subtle)", color: "var(--success-text)" },
  mid: { background: "var(--info-subtle)", color: "var(--info-text)" },
  low: { background: "var(--warn-subtle)", color: "var(--warn-text)" },
  vlow: { background: "var(--error-subtle)", color: "var(--error-text)" },
};

export function SpeakingHistory({ rows }: { rows: SpeakingHistoryRow[] }) {
  const router = useRouter();
  const [deleted, setDeleted] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function del(id: string) {
    setBusy(id);
    const res = await deleteSpeakingRecording(id);
    setBusy(null);
    if (res.ok) {
      setDeleted((d) => ({ ...d, [id]: true }));
      setConfirming(null);
      router.refresh();
    }
  }

  return (
    <div style={S.wrap}>
      <style>{CSS}</style>
      {/* Мобильный путь назад — на &le;430px бургер единственный выход. */}
      <div className="mob-back">
        <Button variant="ghost" size="sm" icon="arrow-left" href="/app/speaking">Speaking</Button>
      </div>
      <header style={S.header}>
        <div>
          <h1 style={S.h1}>Speaking history</h1>
          <p style={S.sub}>Every analysis is saved as a snapshot — reopen any one and it never re-scores.</p>
        </div>
        <Button href="/app/speaking" variant="secondary" trailingIcon="arrow-right">Record another</Button>
      </header>

      {rows.length === 0 ? (
        <div style={S.empty}>No analyses yet — record your first answer.</div>
      ) : (
        <div className="sh-grid">
          {rows.map((r, i) => {
            const gone = r.audioDeleted || deleted[r.submissionId];
            return (
              <div key={r.submissionId} style={S.card} className="sh-card">
                <Link href={`/app/speaking/result/${r.submissionId}`} style={S.cardLink}>
                  <div style={S.meta}>
                    <span style={S.chip}>Part 2</span>
                    <span style={S.date}>{fmtDate(r.createdAt)}</span>
                    {i === 0 && <span style={S.latest}>Latest</span>}
                  </div>
                  <div style={S.prompt}>{r.prompt}</div>
                </Link>
                <div style={S.foot}>
                  <span style={{ ...S.band, ...BAND_TONE[bandLevel(r.bandLow, r.bandHigh)] }}>
                    {r.bandLow.toFixed(1)}–{r.bandHigh.toFixed(1)}
                  </span>
                  <span style={S.conf}>{confidenceLabel(r.confidence)}</span>
                  <span style={S.delWrap}>
                    {gone ? (
                      <span style={S.goneTag}>
                        <Icon name="trash" size={12} strokeWidth={2.2} /> Recording deleted
                      </span>
                    ) : confirming === r.submissionId ? (
                      <>
                        <Button size="sm" variant="danger" icon="trash" loading={busy === r.submissionId} disabled={busy === r.submissionId} onClick={() => del(r.submissionId)}>Delete</Button>
                        <Button size="sm" variant="ghost" disabled={busy === r.submissionId} onClick={() => setConfirming(null)}>Cancel</Button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setConfirming(r.submissionId)} style={S.delBtn} className="sh-del">
                        <Icon name="trash" size={13} strokeWidth={2.2} /> Delete recording
                      </button>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CSS = `
.sh-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
@media (max-width:640px){.sh-grid{grid-template-columns:1fr}}
.sh-card:hover{border-color:var(--brand-border)!important;box-shadow:var(--shadow-solid-lg)}
.sh-del:hover{color:var(--error-text)!important}
/* Тап-таргет 44px на touch — кнопка была padding:4. */
@media (pointer:coarse){.sh-del{min-height:44px}}
.mob-back{display:none}
@media (max-width:430px){ .mob-back{display:block} }
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 880, margin: "0 auto", padding: "24px 18px 56px", display: "flex", flexDirection: "column", gap: 22, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  header: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },
  h1: { margin: 0, fontSize: 26, fontWeight: 700, color: "var(--text-primary)" },
  sub: { margin: "8px 0 0", fontSize: 15, color: "var(--text-muted)", maxWidth: "54ch" },

  empty: { padding: "36px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)" },

  card: { display: "flex", flexDirection: "column", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "16px 18px", transition: "border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)" },
  cardLink: { textDecoration: "none", color: "inherit", display: "block" },
  meta: { display: "flex", alignItems: "center", gap: 9, marginBottom: 10, flexWrap: "wrap" },
  chip: { fontSize: 11, fontWeight: 700, color: "var(--text-link)", background: "var(--brand-subtle)", padding: "2px 9px", borderRadius: "var(--radius-full)" },
  date: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" },
  latest: { fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--success-text)", background: "var(--success-subtle)", padding: "2px 8px", borderRadius: "var(--radius-full)" },
  prompt: { fontSize: 14.5, lineHeight: 1.4, fontWeight: 600, color: "var(--text-primary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  foot: { display: "flex", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)", flexWrap: "wrap" },
  band: { fontFamily: "var(--font-mono)", fontSize: 14.5, fontWeight: 800, padding: "4px 10px", borderRadius: "var(--radius-md)" },
  conf: { fontSize: 12, color: "var(--text-muted)" },
  delWrap: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 },
  goneTag: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" },
  delBtn: { display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "transparent", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 4, transition: "var(--transition-colors)" },
};
