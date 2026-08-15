import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { writingFeatureEnabled } from "@/env";
import { listUserHistory } from "@/lib/writing/read";
import { writingCategoryLabel, confidenceLabel } from "@/lib/writing/labels";
import { AppShell } from "../../_AppShell";
import { Button } from "@/components/core/Button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Writing history | bando" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;

// Band-level → chip tone. The chip carries the colour (replacing the catalog cards'
// topic colour) so the score reads at a glance: green 7+, blue 6, gold 5, red <5.
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

/**
 * Attempt history (`/app/writing/history`) — a two-column card grid. Every analysis is
 * a frozen snapshot; the card links to its immutable result, which never re-scores. The
 * band chip carries the level colour. Owner-scoped read; server component.
 */
export default async function WritingHistoryPage() {
  const user = await getUser();
  if (!user) redirect("/auth");
  if (!writingFeatureEnabled()) redirect("/app/practice");

  const rows = await listUserHistory(user.id);

  return (
    <AppShell active="practice">
      <div style={S.wrap}>
        <style>{CSS}</style>
        {/* Мобильный путь назад — на &le;430px бургер единственный выход. */}
        <div className="mob-back">
          <Button variant="ghost" size="sm" icon="arrow-left" href="/app/writing">Writing</Button>
        </div>
        <header>
          <h1 style={S.h1}>Attempt history</h1>
          <p style={S.sub}>Every analysis is saved as a snapshot — reopen any one and it never re-scores.</p>
        </header>

        {rows.length === 0 ? (
          <div style={S.empty}>No analyses yet — write your first essay.</div>
        ) : (
          <div className="wh-grid">
            {rows.map((r, i) => (
              <Link key={r.submissionId} href={`/app/writing/result/${r.submissionId}`} style={S.card} className="wh-card">
                <div style={S.meta}>
                  <span style={S.chip}>{writingCategoryLabel(r.category)}</span>
                  <span style={S.date}>{fmtDate(r.createdAt)}</span>
                  {i === 0 && <span style={S.latest}>Latest</span>}
                </div>
                <div style={S.prompt}>{r.prompt}</div>
                <div style={S.foot}>
                  <span style={{ ...S.band, ...BAND_TONE[bandLevel(r.bandLow, r.bandHigh)] }}>
                    {r.bandLow.toFixed(1)}–{r.bandHigh.toFixed(1)}
                  </span>
                  <span style={S.conf}>{confidenceLabel(r.confidence)}</span>
                  <span style={S.arrow}>→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

const CSS = `
.wh-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
@media (max-width:640px){.wh-grid{grid-template-columns:1fr}}
.wh-card:hover{transform:translateY(-2px);border-color:var(--brand-border)!important;box-shadow:var(--shadow-solid-lg)}
.mob-back{display:none}
@media (max-width:430px){ .mob-back{display:block} }
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 880, margin: "0 auto", padding: "24px 18px 56px", display: "flex", flexDirection: "column", gap: 22, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  h1: { margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  sub: { margin: "8px 0 0", fontSize: 15, color: "var(--text-muted)", maxWidth: "54ch" },

  empty: { padding: "36px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)" },

  card: { display: "flex", flexDirection: "column", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "16px 18px", textDecoration: "none", color: "inherit", transition: "transform var(--duration-base) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)" },
  meta: { display: "flex", alignItems: "center", gap: 9, marginBottom: 10, flexWrap: "wrap" },
  chip: { fontSize: 11, fontWeight: 700, color: "var(--text-link)", background: "var(--brand-subtle)", padding: "2px 9px", borderRadius: "var(--radius-full)" },
  date: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" },
  latest: { fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--success-text)", background: "var(--success-subtle)", padding: "2px 8px", borderRadius: "var(--radius-full)" },
  // Two-line clamp so cards in a row stay even; prompt wraps (not the old single-line ellipsis).
  prompt: { fontSize: 14.5, lineHeight: 1.4, fontWeight: 600, color: "var(--text-primary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  foot: { display: "flex", alignItems: "center", gap: 10, marginTop: "auto", paddingTop: 14 },
  band: { fontFamily: "var(--font-mono)", fontSize: 14.5, fontWeight: 800, padding: "4px 10px", borderRadius: "var(--radius-md)" },
  conf: { fontSize: 12, color: "var(--text-muted)" },
  arrow: { marginLeft: "auto", color: "var(--text-link)", fontWeight: 700, fontSize: 15 },
};
