import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { profile, sprintSignup } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin sprint | bando" };

const DATE_FMT = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

/**
 * Admin-only список записавшихся в ручной пилот когорты «спринт к экзамену»
 * (BRIEF §12.3). Владелец сам курирует когорту в Telegram — эта страница только
 * читает список для связи (owner-path JOIN profile; sprint_signup закрыт от
 * клиента). Read-only: никаких статусов/действий, никакой автоматизации.
 */
export default async function AdminSprintPage() {
  const admin = await requireAdmin();

  const rows = await db
    .select({
      id: sprintSignup.id,
      telegramHandle: sprintSignup.telegramHandle,
      examDate: sprintSignup.examDate,
      targetBand: sprintSignup.targetBand,
      createdAt: sprintSignup.createdAt,
      displayName: profile.displayName,
      email: profile.email,
    })
    .from(sprintSignup)
    .innerJoin(profile, eq(profile.id, sprintSignup.userId))
    .orderBy(desc(sprintSignup.createdAt));

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <h1 style={S.h1}>Exam sprint signups</h1>
        <p style={S.sub}>
          {admin.email} · {rows.length} signup(s)
        </p>

        {rows.length === 0 ? (
          <p style={S.hint}>No signups yet.</p>
        ) : (
          <ul style={S.list}>
            {rows.map((r) => (
              <li key={r.id} style={S.row}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={S.rowTitle}>{r.displayName || "—"}</div>
                  <div style={S.meta}>
                    <span>{r.email}</span>
                    <span>· {r.telegramHandle}</span>
                  </div>
                </div>
                <div style={S.cols}>
                  <Col
                    label="Exam date"
                    value={r.examDate ? DATE_FMT.format(new Date(`${r.examDate}T00:00:00Z`)) : "—"}
                  />
                  <Col label="Target band" value={r.targetBand ? Number(r.targetBand).toFixed(1) : "—"} />
                  <Col label="Joined" value={DATE_FMT.format(r.createdAt)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function Col({ label, value }: { label: string; value: string }) {
  return (
    <div style={S.col}>
      <span style={S.colLabel}>{label}</span>
      <span style={S.colValue}>{value}</span>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  page: { padding: "2.5rem 1.5rem 4rem" },
  wrap: { maxWidth: 900, margin: "0 auto" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text-primary)", margin: 0 },
  sub: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", marginTop: 6, fontSize: "var(--text-sm)" },
  hint: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", fontSize: "var(--text-sm)", marginTop: 20 },
  list: { listStyle: "none", padding: 0, margin: "20px 0 0", display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 16px" },
  rowTitle: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--text-primary)" },
  meta: { display: "flex", gap: 4, alignItems: "center", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", marginTop: 4, flexWrap: "wrap" },
  cols: { display: "flex", gap: 20, flexWrap: "wrap" },
  col: { display: "flex", flexDirection: "column", gap: 2, minWidth: 90 },
  colLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" },
  colValue: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" },
};
