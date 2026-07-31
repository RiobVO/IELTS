import type { CSSProperties } from "react";
import { requireAdmin } from "@/lib/auth";
import { Badge, type BadgeTone } from "@/components/core/Badge";
import { Button } from "@/components/core/Button";
import { listAllTasks, type AdminTaskRow } from "@/lib/writing/admin";
import { createWritingTask, publishTask, removeTask, unpublishTask } from "./actions";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<AdminTaskRow["category"], string> = {
  academic: "Academic",
  general: "General Training",
};
const TIER_LABEL: Record<AdminTaskRow["tierRequired"], string> = {
  basic: "Basic",
  premium: "Premium",
  ultra: "Ultra",
};
const DONE_NOTICE: Record<string, string> = {
  published: "Topic published — it's now live in the catalog.",
  unpublished: "Topic unpublished — hidden from the catalog.",
  deleted: "Topic deleted.",
};

/**
 * Admin — manage Writing Lab Task 2 topics. Standalone admin layout (no AppShell),
 * gated by requireAdmin. The form creates topics; the list below publishes/unpublishes
 * them or hard-deletes the ones no student has submitted against. A topic reaches the
 * catalog only once published.
 */
export default async function AdminWritingPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string; done?: string }>;
}) {
  await requireAdmin();
  const { created, error, done } = await searchParams;
  const tasks = await listAllTasks();

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
        {done && DONE_NOTICE[done] && <p style={S.ok}>{DONE_NOTICE[done]}</p>}

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

        <div style={S.listHead}>
          <h2 style={S.h2}>All topics</h2>
          <Badge tone="neutral">{tasks.length}</Badge>
        </div>

        {tasks.length === 0 ? (
          <p style={S.empty}>No topics yet — create one above to get started.</p>
        ) : (
          <ul style={S.list}>
            {tasks.map((t) => (
              <TopicRow key={t.id} task={t} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

/**
 * One row in the topic list: prompt preview + status/category/plan badges, and the
 * per-topic actions. Publish/Unpublish toggles catalog visibility; Delete posts to
 * the guarded removeTask (a topic with submissions is refused server-side, surfacing
 * "unpublish instead"). Each action is its own form so it carries only its own id.
 */
function TopicRow({ task }: { task: AdminTaskRow }) {
  const published = task.status === "published";
  const statusTone: BadgeTone = published ? "success" : "neutral";
  return (
    <li style={S.row}>
      <div style={S.rowMain}>
        <p style={S.prompt}>{task.prompt}</p>
        <div style={S.meta}>
          <Badge tone={statusTone}>{published ? "Published" : "Draft"}</Badge>
          <Badge tone="neutral">{CATEGORY_LABEL[task.category]}</Badge>
          <Badge tone="brand">{TIER_LABEL[task.tierRequired]}</Badge>
        </div>
      </div>
      <div style={S.rowActions}>
        {published ? (
          <form action={unpublishTask}>
            <input type="hidden" name="id" value={task.id} />
            <Button type="submit" size="sm" variant="secondary">Unpublish</Button>
          </form>
        ) : (
          <form action={publishTask}>
            <input type="hidden" name="id" value={task.id} />
            <Button type="submit" size="sm" variant="success" icon="check">Publish</Button>
          </form>
        )}
        <form action={removeTask}>
          <input type="hidden" name="id" value={task.id} />
          <Button type="submit" size="sm" variant="danger" icon="trash">Delete</Button>
        </form>
      </div>
    </li>
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

  listHead: { display: "flex", alignItems: "center", gap: 10, margin: "40px 0 14px" },
  h2: { margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" },
  empty: { margin: 0, padding: "22px 18px", background: "var(--surface)", border: "2px dashed var(--border)", borderRadius: "var(--radius-lg)", color: "var(--text-muted)", fontSize: 14, textAlign: "center" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 },
  row: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 16 },
  rowMain: { flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 },
  prompt: { margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--text-primary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  meta: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  rowActions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
};
