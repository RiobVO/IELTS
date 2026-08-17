import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { vocabDeck } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { Badge } from "@/components/core/Badge";
import { SubmitButton, ConfirmButton } from "@/components/admin/AdminSubmit";
import { setVocabStatus, uploadVocab } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin vocabulary | bando" };

const TIER_LABEL: Record<string, string> = {
  basic: "Basic",
  premium: "Premium",
  ultra: "Ultra",
};
const DONE_NOTICE: Record<string, string> = {
  published: "Deck published — it's now live for students.",
  unpublished: "Deck unpublished — hidden from students.",
};

/**
 * Admin — управление словарными колодами (Vocabulary). Standalone-лейаут (как
 * /admin/writing), гейт requireAdmin. Форма грузит JSON-колоду (parse+persist,
 * идемпотентный upsert по имени файла); список ниже публикует/снимает деки.
 * Owner-путь: админ видит и draft-деки (в отличие от RLS anon-пути).
 */
export default async function AdminVocabPage({
  searchParams,
}: {
  searchParams: Promise<{
    inserted?: string;
    updated?: string;
    total?: string;
    error?: string;
    done?: string;
  }>;
}) {
  const profile = await requireAdmin();
  const sp = await searchParams;

  const decks = await db
    .select({
      id: vocabDeck.id,
      title: vocabDeck.title,
      level: vocabDeck.level,
      status: vocabDeck.status,
      tierRequired: vocabDeck.tierRequired,
      wordCount: vocabDeck.wordCount,
      sourceFilePath: vocabDeck.sourceFilePath,
    })
    .from(vocabDeck)
    .orderBy(desc(vocabDeck.createdAt));

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <h1 style={S.h1}>Vocabulary</h1>
        <p style={S.sub}>
          {profile.email} · {decks.length} deck(s)
        </p>

        {sp.error && <p style={S.err}>{sp.error}</p>}
        {sp.total && (
          <p style={S.ok}>
            Imported — {sp.inserted} inserted, {sp.updated} updated, {sp.total} total card(s).
          </p>
        )}
        {sp.done && DONE_NOTICE[sp.done] && <p style={S.ok}>{DONE_NOTICE[sp.done]}</p>}

        <section style={S.card}>
          <div style={S.cardTitle}>Upload a deck (JSON)</div>
          <p style={S.hint}>
            {`{ "title", "cards": [{ "word", "definition", … }] }`}. Re-uploading the same file
            name updates the deck additively (existing cards keep their study progress). Saved as
            a draft until published.
          </p>
          <form action={uploadVocab} style={S.uploadForm}>
            <input
              type="file"
              name="file"
              accept=".json,application/json"
              required
              aria-label="Vocabulary deck JSON file"
              style={S.file}
            />
            <SubmitButton>Upload</SubmitButton>
          </form>
        </section>

        <div style={S.listHead}>Decks</div>
        {decks.length === 0 ? (
          <p style={S.hint}>Nothing imported yet.</p>
        ) : (
          <ul style={S.list}>
            {decks.map((d) => {
              const published = d.status === "published";
              return (
                <li key={d.id} id={d.id} style={S.row}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={S.rowTitle}>{d.title}</div>
                    <div style={S.meta}>
                      <Badge tone={published ? "success" : "warn"}>{d.status}</Badge>
                      <Badge tone="brand">{TIER_LABEL[d.tierRequired] ?? d.tierRequired}</Badge>
                      {d.level && <Badge tone="neutral">{d.level}</Badge>}
                      <span>· {d.wordCount} card(s)</span>
                    </div>
                  </div>
                  <div style={S.actions}>
                    <form action={setVocabStatus}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="status" value={published ? "draft" : "published"} />
                      {published ? (
                        <ConfirmButton
                          variant="secondary"
                          size="sm"
                          message={`Unpublish “${d.title}”? Students will no longer see this deck.`}
                        >
                          Unpublish
                        </ConfirmButton>
                      ) : (
                        <ConfirmButton
                          variant="success"
                          size="sm"
                          icon="check"
                          message={`Publish “${d.title}” live to students now?`}
                        >
                          Publish
                        </ConfirmButton>
                      )}
                    </form>
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

const S: Record<string, CSSProperties> = {
  page: { padding: "2.5rem 1.5rem 4rem" },
  wrap: { maxWidth: 760, margin: "0 auto" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: 0 },
  sub: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", marginTop: 6, fontSize: "var(--text-sm)" },
  err: { background: "var(--error-subtle)", color: "var(--error-text)", padding: "10px 12px", borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
  ok: { background: "var(--success-subtle)", color: "var(--success-text)", padding: "10px 12px", borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
  card: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "20px", marginTop: 20 },
  cardTitle: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-base)", color: "var(--text-primary)" },
  hint: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: "6px 0 0", lineHeight: 1.5 },
  uploadForm: { display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" },
  file: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", flex: 1, minWidth: 0, color: "var(--text-secondary)" },
  listHead: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-base)", color: "var(--text-primary)", margin: "28px 0 12px" },
  list: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 16px" },
  rowTitle: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  meta: { display: "flex", gap: 8, alignItems: "center", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", marginTop: 6, flexWrap: "wrap" },
  actions: { flexShrink: 0 },
};
