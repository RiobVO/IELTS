import type { CSSProperties } from "react";
import { requireAdmin } from "@/lib/auth";
import { Badge } from "@/components/core/Badge";
import { Button } from "@/components/core/Button";
import { createWritingTask } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Admin — create a Writing Lab Task 2 topic. Standalone admin layout (no AppShell),
 * gated by requireAdmin. The form posts to the createWritingTask server action; a
 * topic reaches the catalog only after Publish.
 */
export default async function AdminWritingPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  await requireAdmin();
  const { created, error } = await searchParams;

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <div style={S.head}>
          <h1 style={S.h1}>New Task 2 topic</h1>
          <Badge tone="neutral">Draft</Badge>
        </div>
        <p style={S.sub}>Students see this topic in the catalog only after you publish it.</p>

        {error && <p style={S.err}>{error}</p>}
        {created && (
          <p style={S.ok}>
            Topic saved as {created === "published" ? "published — it's now live in the catalog." : "a draft."}
          </p>
        )}

        <form action={createWritingTask} style={S.card}>
          <label style={S.label} htmlFor="prompt">Prompt</label>
          <textarea
            id="prompt"
            name="prompt"
            required
            rows={6}
            placeholder="Some people believe that…"
            style={S.textarea}
          />

          <div style={S.grid2}>
            <div>
              <label style={S.label} htmlFor="category">Category</label>
              <select id="category" name="category" defaultValue="academic" style={S.select}>
                <option value="academic">Academic</option>
                <option value="general">General Training</option>
              </select>
            </div>
            <div>
              <label style={S.label} htmlFor="tier">Required plan</label>
              <select id="tier" name="tier" defaultValue="ultra" style={S.select}>
                <option value="basic">Basic</option>
                <option value="premium">Premium</option>
                <option value="ultra">Ultra</option>
              </select>
            </div>
          </div>

          <div style={S.actions}>
            <Button type="submit" name="intent" value="publish" icon="check">Publish topic</Button>
            <Button type="submit" name="intent" value="draft" variant="secondary">Save draft</Button>
            <span style={S.caption}>Draft → Published</span>
          </div>
        </form>
      </div>
    </main>
  );
}

const S: Record<string, CSSProperties> = {
  page: { minHeight: "100dvh", background: "var(--bg-base)", padding: "40px 18px 64px" },
  wrap: { maxWidth: 700, margin: "0 auto", fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  head: { display: "flex", alignItems: "center", gap: 12 },
  h1: { margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" },
  sub: { margin: "8px 0 0", fontSize: 14, color: "var(--text-muted)" },

  err: { marginTop: 16, padding: "12px 14px", borderRadius: "var(--radius-md)", background: "var(--error-subtle)", color: "var(--error-text)", fontSize: 14, fontWeight: 600 },
  ok: { marginTop: 16, padding: "12px 14px", borderRadius: "var(--radius-md)", background: "var(--success-subtle)", color: "var(--success-text)", fontSize: 14, fontWeight: 600 },

  card: { marginTop: 22, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 22, display: "flex", flexDirection: "column", gap: 8 },
  label: { fontSize: 12, fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6, display: "block" },
  textarea: { width: "100%", resize: "vertical", minHeight: 130, background: "var(--surface-raised)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: 15, lineHeight: 1.5, border: "2px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px", outline: "none", marginBottom: 14 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 },
  select: { width: "100%", height: 44, background: "var(--surface-raised)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: 15, border: "2px solid var(--border)", borderRadius: "var(--radius-md)", padding: "0 12px", cursor: "pointer" },
  actions: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  caption: { fontSize: 12, color: "var(--text-muted)" },
};
