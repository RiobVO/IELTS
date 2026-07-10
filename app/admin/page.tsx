import type { Metadata } from "next";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { answerKey, contentItem, question } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { categoryLabel } from "@/lib/labels";
import { summarizeReview, type ReviewRow, type ReviewSummary } from "@/lib/content/review-summary";
import { Badge } from "@/components/core/Badge";
import { SubmitButton, ConfirmButton } from "@/components/admin/AdminSubmit";
import { ContentFilter } from "@/components/admin/ContentFilter";
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

  // Сводка ключа для драфтов (P3): админ подтверждает ключ, видя разбивку, а не вслепую.
  // Читаем owner-путём; СЫРОЙ accept остаётся на сервере — в JSX уходят только агрегаты
  // (summarizeReview), поэтому ответы не утекают ни в клиент, ни в бота.
  const draftIds = items.filter((it) => it.status !== "published").map((it) => it.id);
  const summaries = new Map<string, ReviewSummary>();
  if (draftIds.length > 0) {
    const rows = await db
      .select({
        contentItemId: question.contentItemId,
        number: question.number,
        qtype: question.qtype,
        mode: answerKey.mode,
        accept: answerKey.accept,
      })
      .from(question)
      .leftJoin(answerKey, eq(answerKey.questionId, question.id))
      .where(inArray(question.contentItemId, draftIds));

    const byItem = new Map<string, ReviewRow[]>();
    for (const r of rows) {
      // accept — jsonb; парсер пишет string[], но не-массив (напр. {}) уронил бы .some.
      const acc = Array.isArray(r.accept) ? (r.accept as string[]) : [];
      const emptyAccept = r.mode === null || !acc.some((a) => (a ?? "").trim() !== "");
      const list = byItem.get(r.contentItemId) ?? [];
      // accept сюда НЕ кладём — только производный флаг emptyAccept.
      list.push({ number: r.number, qtype: r.qtype, mode: r.mode, emptyAccept });
      byItem.set(r.contentItemId, list);
    }
    for (const [id, rs] of byItem) summaries.set(id, summarizeReview(rs));
  }

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <h1 style={S.h1}>Admin</h1>
        <p style={S.sub}>
          {profile.email} · {items.length} test(s)
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
            <input
              type="file"
              name="file"
              accept=".html,.htm,text/html"
              required
              aria-label="Test HTML file"
              style={S.file}
            />
            <SubmitButton>Upload</SubmitButton>
          </form>
        </section>

        <div style={S.listHead}>Content</div>
        {items.length === 0 ? (
          <p style={S.hint}>Nothing uploaded yet.</p>
        ) : (
          <ContentFilter statuses={Array.from(new Set(items.map((i) => i.status))).sort()}>
          <ul style={S.list}>
            {items.map((it) => {
              const warnings = (it.importWarnings as string[] | null) ?? [];
              const reviewed = it.reviewedAt != null;
              const isDraft = it.status !== "published";
              const summary = isDraft ? summaries.get(it.id) : undefined;
              return (
                // id-якорь: телеграм-бот шлёт ссылку /admin#<uuid> на review конкретного теста;
                // data-* — для клиентского ContentFilter (title/status).
                <li
                  key={it.id}
                  id={it.id}
                  data-admin-row
                  data-title={it.title.toLowerCase()}
                  data-status={it.status}
                  style={S.row}
                >
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
                    {summary && (
                      <div style={S.summary}>
                        <div style={S.sumRow}>
                          <span style={S.sumLabel}>Key · {summary.total} q.</span>
                          <span style={S.sumChips}>
                            {Object.entries(summary.byMode).map(([m, n]) => (
                              <span key={m} style={S.chip}>
                                {m} · {n}
                              </span>
                            ))}
                          </span>
                        </div>
                        <div style={S.sumRow}>
                          <span style={S.sumLabel}>Types</span>
                          <span style={S.sumChips}>
                            {Object.entries(summary.byType).map(([t, n]) => (
                              <span key={t} style={S.chipMuted}>
                                {t} · {n}
                              </span>
                            ))}
                          </span>
                        </div>
                        {(summary.emptyKeys > 0 ||
                          summary.duplicateNumbers.length > 0 ||
                          summary.numberGap) && (
                          <div style={S.sumFlags}>
                            {summary.emptyKeys > 0 && (
                              <span style={S.flag}>⚠ {summary.emptyKeys} empty key(s)</span>
                            )}
                            {summary.duplicateNumbers.length > 0 && (
                              <span style={S.flag}>
                                ⚠ duplicate #: {summary.duplicateNumbers.join(", ")}
                              </span>
                            )}
                            {summary.numberGap && summary.duplicateNumbers.length === 0 && (
                              <span style={S.flag}>⚠ number gap</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
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
                        <ConfirmButton
                          variant="secondary"
                          size="sm"
                          message={`Unpublish “${it.title}”? Students will no longer see it in the catalog.`}
                        >
                          Unpublish
                        </ConfirmButton>
                      </form>
                    ) : reviewed ? (
                      <form action={setStatus}>
                        <input type="hidden" name="id" value={it.id} />
                        <input type="hidden" name="status" value="published" />
                        <ConfirmButton
                          variant="success"
                          size="sm"
                          icon="check"
                          message={`Publish “${it.title}” live to real students now?`}
                        >
                          Publish
                        </ConfirmButton>
                      </form>
                    ) : (
                      <form action={markReviewed}>
                        <input type="hidden" name="id" value={it.id} />
                        <SubmitButton size="sm">Approve</SubmitButton>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          </ContentFilter>
        )}
      </div>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: "2.5rem 1.5rem 4rem" },
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
  summary: { marginTop: 10, background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 },
  sumRow: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" },
  sumLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 800, color: "var(--text-secondary)", minWidth: 72 },
  sumChips: { display: "flex", gap: 6, flexWrap: "wrap" },
  chip: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-primary)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "1px 6px" },
  chipMuted: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "1px 6px" },
  sumFlags: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 },
  flag: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--error-text)" },
  warnBox: { marginTop: 10, background: "var(--warn-subtle, var(--bg-base))", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px" },
  warnSummary: { cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--warn-text, var(--text-secondary))" },
  warnList: { margin: "8px 0 0", padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 4 },
  warnItem: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 },
};
