import type { Metadata } from "next";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentItem } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { categoryLabel } from "@/lib/labels";
import { Button } from "@/components/core/Button";
import { Badge } from "@/components/core/Badge";
import { markReviewed, setStatus, uploadTest } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin | bando" };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ uploaded?: string; q?: string; w?: string; brand?: string; error?: string }>;
}) {
  const profile = await requireAdmin();
  const sp = await searchParams;

  // Owner db: admin sees ALL content (incl. draft), unlike the RLS anon path.
  const items = await db
    .select({
      id: contentItem.id,
      title: contentItem.title,
      section: contentItem.section,
      category: contentItem.category,
      status: contentItem.status,
      reviewedAt: contentItem.reviewedAt,
      importWarnings: contentItem.importWarnings,
      // Внешняя ссылка написана ТЕКСТОМ (content_item.id): drizzle рендерит
      // ${contentItem.id} в raw-sql как неквалифицированный "id", который внутри
      // подзапроса резолвится в question.id → самосравнение → всегда 0.
      questions: sql<number>`(SELECT count(*)::int FROM question q WHERE q.content_item_id = content_item.id)`,
    })
    .from(contentItem)
    .orderBy(desc(contentItem.createdAt));

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <h1 style={S.h1}>Admin</h1>
        <p style={S.sub}>
          {profile.email} · role=admin · {items.length} test(s)
        </p>

        {sp.error && <p style={S.err}>{sp.error}</p>}
        {sp.uploaded && (
          <p style={S.ok}>
            Uploaded “{sp.uploaded}” — {sp.q} question(s)
            {Number(sp.w) > 0 ? `, ${sp.w} warning(s)` : ""}. Status: draft.
          </p>
        )}
        {sp.brand && (
          <p style={S.err}>
            ⚠️ Branding not auto-cleaned: {sp.brand}. The source logo / foreign link may
            still show — this file’s header is from an unrecognized source. Check it in the
            runner before publishing (and the brand re-skin may need extending).
          </p>
        )}

        <section style={S.card}>
          <div style={S.cardTitle}>Upload a test (HTML)</div>
          <p style={S.hint}>
            Template-conformant HTML (§4.2.1). The parser extracts passage, questions and key; the test is saved as a draft until published.
          </p>
          <form action={uploadTest} style={S.uploadForm}>
            <input type="file" name="file" accept=".html,.htm,text/html" required style={S.file} />
            <Button type="submit">Upload</Button>
          </form>
        </section>

        <div style={S.listHead}>Content</div>
        {items.length === 0 ? (
          <p style={S.hint}>Nothing uploaded yet.</p>
        ) : (
          <ul style={S.list}>
            {items.map((it) => {
              const warnings = (it.importWarnings as string[] | null) ?? [];
              const reviewed = it.reviewedAt != null;
              const isDraft = it.status !== "published";
              return (
                // id-якорь: телеграм-бот шлёт ссылку /admin#<uuid> на review конкретного теста
                <li key={it.id} id={it.id} style={S.row}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={S.rowTitle}>{it.title}</div>
                    <div style={S.meta}>
                      <Badge tone="brand">{categoryLabel(it.category)}</Badge>
                      <span>{it.section}</span>
                      <span>· {it.questions} q.</span>
                      <Badge tone={it.status === "published" ? "success" : "warn"}>{it.status}</Badge>
                      {isDraft && (
                        <Badge tone={reviewed ? "success" : "warn"}>
                          {reviewed ? "reviewed" : "needs review"}
                        </Badge>
                      )}
                      {warnings.length > 0 && <span>· {warnings.length} warning(s)</span>}
                    </div>
                    {isDraft && warnings.length > 0 && (
                      <details style={S.warnBox}>
                        <summary style={S.warnSummary}>
                          Review {warnings.length} parser warning(s) before approving
                        </summary>
                        <ul style={S.warnList}>
                          {warnings.map((w, i) => (
                            <li key={i} style={S.warnItem}>{w}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  <div style={S.actions}>
                    {it.status === "published" ? (
                      <form action={setStatus}>
                        <input type="hidden" name="id" value={it.id} />
                        <input type="hidden" name="status" value="draft" />
                        <Button type="submit" variant="secondary" size="sm">Unpublish</Button>
                      </form>
                    ) : reviewed ? (
                      <form action={setStatus}>
                        <input type="hidden" name="id" value={it.id} />
                        <input type="hidden" name="status" value="published" />
                        <Button type="submit" variant="secondary" size="sm">Publish</Button>
                      </form>
                    ) : (
                      <form action={markReviewed}>
                        <input type="hidden" name="id" value={it.id} />
                        <Button type="submit" size="sm">Approve</Button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", padding: "2.5rem 1.5rem 4rem", background: "var(--bg-base)" },
  wrap: { maxWidth: 760, margin: "0 auto" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: 0 },
  sub: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", marginTop: 6, fontSize: "var(--text-sm)" },
  err: { background: "var(--error-subtle)", color: "var(--error-text)", padding: "10px 12px", borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
  ok: { background: "var(--success-subtle)", color: "var(--success-text)", padding: "10px 12px", borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
  card: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "20px", marginTop: 20 },
  cardTitle: { fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: "var(--text-base)", color: "var(--text-primary)" },
  hint: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: "6px 0 0", lineHeight: 1.5 },
  uploadForm: { display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" },
  file: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", flex: 1, minWidth: 0, color: "var(--text-secondary)" },
  listHead: { fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: "var(--text-base)", color: "var(--text-primary)", margin: "28px 0 12px" },
  list: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 16px" },
  rowTitle: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  meta: { display: "flex", gap: 8, alignItems: "center", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", marginTop: 6, flexWrap: "wrap" },
  actions: { flexShrink: 0 },
  warnBox: { marginTop: 10, background: "var(--warn-subtle, var(--bg-base))", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px" },
  warnSummary: { cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--warn-text, var(--text-secondary))" },
  warnList: { margin: "8px 0 0", padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 4 },
  warnItem: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 },
};
