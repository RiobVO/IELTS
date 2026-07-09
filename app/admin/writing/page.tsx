import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { Badge, type BadgeTone } from "@/components/core/Badge";
import { Button } from "@/components/core/Button";
import { listAllTasks, type AdminTaskRow } from "@/lib/writing/admin";
import {
  WRITING_TASK_TYPES,
  WRITING_TOPICS,
  writingDifficultyLabel,
  writingTaskTypeLabel,
  writingTopicLabel,
} from "@/lib/writing/topic-meta";
import { createWritingTask, publishTask, removeTask, unpublishTask } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin writing | bando" };

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

// Form grids stack to one column below 640px — no @media existed at all before.
const ADMIN_RESP_CSS = `
.adm-grid2{grid-template-columns:1fr}
.adm-grid3{grid-template-columns:1fr}
@media (min-width:640px){
  .adm-grid2{grid-template-columns:1fr 1fr}
  .adm-grid3{grid-template-columns:1fr 1fr 1fr}
}
`;

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
      <style>{ADMIN_RESP_CSS}</style>
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
          <div className="adm-grid2" style={S.grid2}>
            <div>
              <label style={S.label} htmlFor="task_part">Part</label>
              <select id="task_part" name="task_part" defaultValue="task2" style={S.select}>
                <option value="task2">Task 2 — essay</option>
                <option value="task1">Task 1 — chart / diagram (Academic)</option>
              </select>
            </div>
            <div>
              <label style={S.label} htmlFor="image">Task 1 chart image</label>
              <input
                id="image"
                name="image"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={S.file}
              />
              <span style={S.caption}>Required for Task 1 · PNG/JPEG/WebP · ignored for Task 2</span>
            </div>
          </div>

          <label style={S.label} htmlFor="prompt">Prompt</label>
          <textarea
            id="prompt"
            name="prompt"
            required
            rows={6}
            placeholder="The chart below shows… / Some people believe that…"
            style={S.textarea}
          />

          <div className="adm-grid2" style={S.grid2}>
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

          <div className="adm-grid2" style={S.grid2}>
            <div>
              <label style={S.label} htmlFor="topic">Topic</label>
              <select id="topic" name="topic" defaultValue="auto" style={S.select}>
                <option value="auto">Auto-detect</option>
                <option value="">None</option>
                {WRITING_TOPICS.map((t) => (
                  <option key={t} value={t}>{writingTopicLabel[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={S.label} htmlFor="task_type">Task type</label>
              <select id="task_type" name="task_type" defaultValue="auto" style={S.select}>
                <option value="auto">Auto-detect</option>
                {WRITING_TASK_TYPES.map((t) => (
                  <option key={t} value={t}>{writingTaskTypeLabel[t]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="adm-grid3" style={S.grid3}>
            <div>
              <label style={S.label} htmlFor="difficulty">Difficulty</label>
              <select id="difficulty" name="difficulty" defaultValue="2" style={S.select}>
                <option value="">None</option>
                <option value="1">Foundation</option>
                <option value="2">Core</option>
                <option value="3">Stretch</option>
              </select>
            </div>
            <div>
              <label style={S.label} htmlFor="band_low">Band from</label>
              <input id="band_low" name="band_low" type="number" min={0} max={9} step={0.5} defaultValue="6.5" style={S.select} />
            </div>
            <div>
              <label style={S.label} htmlFor="band_high">Band to</label>
              <input id="band_high" name="band_high" type="number" min={0} max={9} step={0.5} defaultValue="7.5" style={S.select} />
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
          <Badge tone="brand">{task.taskPart === "task1" ? "Task 1" : "Task 2"}</Badge>
          <Badge tone="neutral">{CATEGORY_LABEL[task.category]}</Badge>
          <Badge tone="brand">{TIER_LABEL[task.tierRequired]}</Badge>
          {task.topic && <Badge tone="neutral">{writingTopicLabel[task.topic]}</Badge>}
          {task.taskType && <Badge tone="neutral">{writingTaskTypeLabel[task.taskType]}</Badge>}
          {task.difficulty && <Badge tone="neutral">{writingDifficultyLabel[task.difficulty]}</Badge>}
          {task.bandLow != null && task.bandHigh != null && (
            <Badge tone="neutral">{`Band ${task.bandLow.toFixed(1)}–${task.bandHigh.toFixed(1)}`}</Badge>
          )}
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
  grid2: { display: "grid", gap: 14, marginBottom: 18 },
  grid3: { display: "grid", gap: 14, marginBottom: 18 },
  select: { width: "100%", height: 44, background: "var(--surface-raised)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: 15, border: "2px solid var(--border)", borderRadius: "var(--radius-md)", padding: "0 12px", cursor: "pointer" },
  file: { width: "100%", background: "var(--surface-raised)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: 13, border: "2px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px", cursor: "pointer" },
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
  rowActions: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" },
};
