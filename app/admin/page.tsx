import type { Metadata } from "next";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { answerKey, contentItem, question } from "@/db/schema";
import { l1FeatureEnabled } from "@/env";
import { requireAdmin } from "@/lib/auth";
import { categoryLabel } from "@/lib/labels";
import { summarizeReview, type ReviewRow, type ReviewSummary } from "@/lib/content/review-summary";
import { Badge, type BadgeTone } from "@/components/core/Badge";
import { SubmitButton, ConfirmButton } from "@/components/admin/AdminSubmit";
import { ContentTools } from "@/components/admin/ContentTools";
import { UndoToast } from "@/components/admin/UndoToast";
import { bulkSetStatus, markReviewed, regenerateL1, setStatus, uploadTest } from "./actions";

/** l1_status → Badge tone. */
function l1Tone(status: string): BadgeTone {
  if (status === "done") return "success";
  if (status === "generating") return "brand";
  if (status === "failed") return "error";
  return "neutral"; // pending
}

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin | bando" };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    uploaded?: string;
    q?: string;
    w?: string;
    brand?: string;
    error?: string;
    bulk?: string;
    done?: string;
    did?: string;
  }>;
}) {
  const profile = await requireAdmin();
  const sp = await searchParams;
  const l1On = l1FeatureEnabled();

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
      l1Status: contentItem.l1Status,
      // Внешняя ссылка написана ТЕКСТОМ (content_item.id): drizzle рендерит
      // ${contentItem.id} в raw-sql как неквалифицированный "id", который внутри
      // подзапроса резолвится в question.id → самосравнение → всегда 0.
      questions: sql<number>`(SELECT count(*)::int FROM question q WHERE q.content_item_id = content_item.id)`,
    })
    .from(contentItem)
    .orderBy(desc(contentItem.createdAt));

  // Сводка ключа для драфтов (P3): админ подтверждает ключ, видя разбивку, а не вслепую.
  // Читаем owner-путём; СЫРОЙ accept остаётся на сервере — в JSX уходят только агрегаты
  // (summarizeReview), поэтому ответы не утекают ни в клиент, ни в бота. Заодно считаем
  // покрытие L1-объяснений (explanation_ru) для строки «L1 (RU)» ниже (0050).
  const draftIds = items.filter((it) => it.status !== "published").map((it) => it.id);
  const summaries = new Map<string, ReviewSummary>();
  const l1Coverage = new Map<string, { done: number; total: number }>();
  if (draftIds.length > 0) {
    const rows = await db
      .select({
        contentItemId: question.contentItemId,
        number: question.number,
        qtype: question.qtype,
        mode: answerKey.mode,
        accept: answerKey.accept,
        explanationRu: answerKey.explanationRu,
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

      const l1 = l1Coverage.get(r.contentItemId) ?? { done: 0, total: 0 };
      l1.total += 1;
      if ((r.explanationRu ?? "").trim() !== "") l1.done += 1;
      l1Coverage.set(r.contentItemId, l1);
    }
    for (const [id, rs] of byItem) summaries.set(id, summarizeReview(rs));
  }

  // Тост Undo после publish/unpublish: находим затронутый тест по ?did.
  const undoItem = sp.done && sp.did ? items.find((i) => i.id === sp.did) : undefined;

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <h1 style={S.h1}>Admin</h1>
        <p style={S.sub}>
          {profile.email} · {items.length} test(s)
        </p>

        {sp.error && <p style={S.err}>{sp.error}</p>}
        {sp.bulk && <p style={S.ok}>{sp.bulk}</p>}
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

        <details style={S.help}>
          <summary style={S.helpSummary}>How this works · shortcuts</summary>
          <div style={S.helpBody}>
            <p style={S.helpP}>
              Upload parses the test and saves a <b>draft</b>. Review the key summary and any parser
              warnings, <b>Approve</b> to unlock publishing, then <b>Publish</b> — a published test is
              live to real students.
            </p>
            <ul style={S.helpList}>
              <li>
                <kbd style={S.kbd}>/</kbd> — focus the filter
              </li>
              <li>
                <b>Select all</b> → <b>Approve</b> / <b>Publish</b> — act on many drafts at once
              </li>
              <li>Undo appears briefly after publish / unpublish</li>
            </ul>
          </div>
        </details>

        <div style={S.listHead}>Content</div>
        {items.length === 0 ? (
          <p style={S.hint}>Nothing uploaded yet.</p>
        ) : (
          <ContentTools statuses={Array.from(new Set(items.map((i) => i.status))).sort()} bulkAction={bulkSetStatus}>
          <ul style={S.list}>
            {items.map((it) => {
              const warnings = (it.importWarnings as string[] | null) ?? [];
              const reviewed = it.reviewedAt != null;
              const isDraft = it.status !== "published";
              const summary = isDraft ? summaries.get(it.id) : undefined;
              return (
                // id-якорь: телеграм-бот шлёт ссылку /admin#<uuid> на review конкретного теста;
                // data-* + чекбокс — для клиентского ContentTools (фильтр + bulk-выбор).
                <li
                  key={it.id}
                  id={it.id}
                  data-admin-row
                  data-title={it.title.toLowerCase()}
                  data-status={it.status}
                  style={S.row}
                >
                  {isDraft && (
                    <input
                      type="checkbox"
                      name="ids"
                      value={it.id}
                      form="admin-bulk"
                      data-admin-check
                      aria-label={`Select ${it.title}`}
                      style={S.check}
                    />
                  )}
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
                    {isDraft && (
                      <div style={{ ...S.sumRow, marginTop: 10 }}>
                        <span style={S.sumLabel}>L1 (RU)</span>
                        {l1On ? (
                          <>
                            <Badge tone={l1Tone(it.l1Status)}>{it.l1Status}</Badge>
                            <span style={S.chipMuted}>
                              {(l1Coverage.get(it.id) ?? { done: 0, total: 0 }).done}/
                              {(l1Coverage.get(it.id) ?? { done: 0, total: 0 }).total} explained
                            </span>
                            <form action={regenerateL1}>
                              <input type="hidden" name="id" value={it.id} />
                              <SubmitButton variant="secondary" size="sm">Regenerate</SubmitButton>
                            </form>
                          </>
                        ) : (
                          <span style={S.chipMuted}>L1 generation is off (no model configured)</span>
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
                        {/* reversible → Undo-тост, не confirm (снимаем лишнее трение). */}
                        <SubmitButton variant="secondary" size="sm">Unpublish</SubmitButton>
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
          </ContentTools>
        )}

        {undoItem && (
          <UndoToast
            message={
              sp.done === "published"
                ? `Published “${undoItem.title}” — live to students.`
                : `Unpublished “${undoItem.title}”.`
            }
            reverseAction={setStatus}
            id={undoItem.id}
            reverseStatus={sp.done === "published" ? "draft" : "published"}
          />
        )}
      </div>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: "2.5rem 1.5rem 4rem" },
  wrap: { maxWidth: 760, margin: "0 auto" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text-primary)", margin: 0 },
  sub: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", marginTop: 6, fontSize: "var(--text-sm)" },
  err: { background: "var(--error-subtle)", color: "var(--error-text)", padding: "10px 12px", borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
  ok: { background: "var(--success-subtle)", color: "var(--success-text)", padding: "10px 12px", borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
  card: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "20px", marginTop: 20 },
  cardTitle: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-base)", color: "var(--text-primary)" },
  hint: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: "6px 0 0", lineHeight: 1.5 },
  check: { marginTop: 3, width: 16, height: 16, accentColor: "var(--brand)", cursor: "pointer", flexShrink: 0 },
  help: { marginTop: 20, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 14px" },
  helpSummary: { cursor: "pointer", fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--text-secondary)" },
  helpBody: { marginTop: 10 },
  helpP: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 },
  helpList: { margin: "10px 0 0", padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 4, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5 },
  kbd: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", background: "var(--surface-inset)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "1px 6px", color: "var(--text-primary)" },
  uploadForm: { display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" },
  file: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", flex: 1, minWidth: 0, color: "var(--text-secondary)" },
  listHead: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-base)", color: "var(--text-primary)", margin: "28px 0 12px" },
  list: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 16px" },
  rowTitle: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  meta: { display: "flex", gap: 8, alignItems: "center", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", marginTop: 6, flexWrap: "wrap" },
  actions: { flexShrink: 0 },
  summary: { marginTop: 10, background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 },
  sumRow: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" },
  sumLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)", minWidth: 72 },
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
