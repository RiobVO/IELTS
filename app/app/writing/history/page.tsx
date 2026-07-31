import type { CSSProperties } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { writingEvalConfig } from "@/env";
import { listUserHistory } from "@/lib/writing/read";
import { writingCategoryLabel, confidenceLabel } from "@/lib/writing/labels";
import { AppShell } from "../../_AppShell";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;

/**
 * Attempt history (`/app/writing/history`). Every analysis is a frozen snapshot —
 * the row links to its immutable result, which never re-scores. Owner-scoped read.
 */
export default async function WritingHistoryPage() {
  const user = await getUser();
  if (!user) redirect("/auth");
  if (writingEvalConfig() === null) redirect("/app/practice");

  const rows = await listUserHistory(user.id);

  return (
    <AppShell active="practice">
      <div style={S.wrap}>
        <style>{CSS}</style>
        <header>
          <h1 style={S.h1}>Attempt history</h1>
          <p style={S.sub}>Every analysis is saved as a snapshot — reopen any one and it never re-scores.</p>
        </header>

        {rows.length === 0 ? (
          <div style={S.empty}>No analyses yet — write your first essay.</div>
        ) : (
          <div style={S.list}>
            {rows.map((r, i) => (
              <Link key={r.submissionId} href={`/app/writing/result/${r.submissionId}`} style={S.row} className="wh-row">
                <div style={{ minWidth: 0 }}>
                  <div style={S.metaRow}>
                    <span style={S.chip}>{writingCategoryLabel(r.category)}</span>
                    <span style={S.date}>{fmtDate(r.createdAt)}</span>
                    {i === 0 && <span style={S.latest}>Latest</span>}
                  </div>
                  <div style={S.prompt}>{r.prompt}</div>
                </div>
                <div style={S.right}>
                  <span style={S.band}>
                    {r.bandLow.toFixed(1)}–{r.bandHigh.toFixed(1)}
                  </span>
                  <span style={S.conf}>{confidenceLabel(r.confidence)} confidence</span>
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
.wh-row:hover{transform:translateY(-2px);border-color:var(--brand-border)!important;box-shadow:var(--shadow-solid-lg)}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 880, margin: "0 auto", padding: "24px 18px 56px", display: "flex", flexDirection: "column", gap: 22, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  h1: { margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  sub: { margin: "8px 0 0", fontSize: 15, color: "var(--text-muted)", maxWidth: "54ch" },

  empty: { padding: "36px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)" },

  list: { display: "flex", flexDirection: "column", gap: 12 },
  row: { display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "16px 20px", textDecoration: "none", color: "inherit", transition: "transform var(--duration-base) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)" },
  metaRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" },
  chip: { fontSize: 11, fontWeight: 700, color: "var(--text-link)", background: "var(--brand-subtle)", padding: "2px 9px", borderRadius: "var(--radius-full)" },
  date: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" },
  latest: { fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--success-text)", background: "var(--success-subtle)", padding: "2px 8px", borderRadius: "var(--radius-full)" },
  prompt: { fontSize: 15, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  right: { flex: "none", display: "flex", alignItems: "center", gap: 14 },
  band: { fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 800, color: "var(--text-primary)" },
  conf: { fontSize: 12, color: "var(--text-muted)" },
  arrow: { color: "var(--text-link)", fontWeight: 700 },
};
