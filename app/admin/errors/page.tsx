import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { errorLog } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { Badge } from "@/components/core/Badge";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin errors | bando" };

/**
 * Owner-only просмотр self-hosted error sink (§11): последние ошибки server + client
 * из error_log. Читается owner-path (Drizzle, RLS-bypassing) под requireAdmin — таблица
 * залочена от клиента (RLS + revoke). Свой мониторинг без внешнего сервиса.
 */
export default async function AdminErrorsPage() {
  await requireAdmin();
  const rows = await db
    .select({
      id: errorLog.id,
      source: errorLog.source,
      message: errorLog.message,
      stack: errorLog.stack,
      url: errorLog.url,
      userId: errorLog.userId,
      createdAt: errorLog.createdAt,
    })
    .from(errorLog)
    .orderBy(desc(errorLog.createdAt))
    .limit(100);

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <h1 style={S.h1}>Error log</h1>
        <p style={S.sub}>
          Last {rows.length} errors (server + client) — self-hosted sink, no external service.
        </p>
        {rows.length === 0 ? (
          <p style={S.hint}>No errors logged yet.</p>
        ) : (
          <ul style={S.list}>
            {rows.map((r) => (
              <li key={r.id} style={S.row}>
                <div style={S.meta}>
                  <Badge tone={r.source === "client" ? "error" : "neutral"}>{r.source}</Badge>
                  <span>{r.createdAt.toISOString()}</span>
                  {r.url && <span style={S.url}>{r.url}</span>}
                  {r.userId && <span>user {r.userId.slice(0, 8)}</span>}
                </div>
                <div style={S.msg}>{r.message}</div>
                {r.stack && (
                  <details style={S.det}>
                    <summary style={S.sum}>stack</summary>
                    <pre style={S.pre}>{r.stack}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: "2.5rem 1.5rem 4rem" },
  // 900 (шире прочих админ-страниц с 760) — намеренно: широкие стек-трейсы читабельнее.
  wrap: { maxWidth: 900, margin: "0 auto" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text-primary)", margin: 0 },
  sub: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", marginTop: 6, fontSize: "var(--text-sm)" },
  hint: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", fontSize: "var(--text-sm)", marginTop: 20 },
  list: { listStyle: "none", padding: 0, margin: "20px 0 0", display: "flex", flexDirection: "column", gap: 8 },
  row: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 16px" },
  meta: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" },
  url: { color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 360, whiteSpace: "nowrap" },
  msg: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-primary)", marginTop: 8, wordBreak: "break-word" },
  det: { marginTop: 8 },
  sum: { cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)" },
  pre: { margin: "8px 0 0", padding: "10px 12px", background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" },
};
