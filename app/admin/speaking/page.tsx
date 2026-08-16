import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { Badge, type BadgeTone } from "@/components/core/Badge";
import { SubmitButton, ConfirmButton } from "@/components/admin/AdminSubmit";
import { speakingDifficultyLabel } from "@/lib/speaking/catalog-meta";
import { listAllTasks, type AdminSpeakingTaskRow } from "@/lib/speaking/admin";
import { createSpeakingTask, publishSpeakingTask, removeSpeakingTask, unpublishSpeakingTask } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin speaking | bando" };

const TIER_LABEL: Record<AdminSpeakingTaskRow["tierRequired"], string> = {
  basic: "Basic",
  premium: "Premium",
  ultra: "Ultra",
};
const DONE_NOTICE: Record<string, string> = {
  published: "Cue card published — it's now live in the catalog.",
  unpublished: "Cue card unpublished — hidden from the catalog.",
  deleted: "Cue card deleted.",
};

// Form grid stacks to one column below 640px — no @media existed at all before.
const ADMIN_RESP_CSS = `
.adm-grid3{grid-template-columns:1fr}
@media (min-width:640px){.adm-grid3{grid-template-columns:1fr 1fr 1fr}}
`;
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Admin — manage Speaking Lab Part 2 cue-cards. Standalone admin layout (no AppShell),
 * gated by requireAdmin. The form creates cue-cards (prompt, 3 bullets, closing,
 * prep/speak timing, tier); the list below publishes/unpublishes or hard-deletes the
 * ones no student has submitted against. A card reaches the catalog only once published.
 */
export default async function AdminSpeakingPage({
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
          <h1 style={S.h1}>New Part 2 cue card</h1>
          <Badge tone="warn">Draft</Badge>
        </div>
        <p style={S.sub}>Students see this cue card in the Speaking catalog only after you publish it.</p>

        {error && <p style={S.err}>{error}</p>}
        {created && (
          <p style={S.ok}>
            Cue card saved as {created === "published" ? "published — it's now live in the catalog." : "a draft."}
          </p>
        )}
        {done && DONE_NOTICE[done] && <p style={S.ok}>{DONE_NOTICE[done]}</p>}

        <form action={createSpeakingTask} style={S.card}>
          <label style={S.label} htmlFor="prompt">Prompt</label>
          <textarea
            id="prompt"
            name="prompt"
            required
            rows={2}
            placeholder="Describe a skill you would like to learn."
            style={S.textarea}
          />

          <div style={S.label}>You should say (exactly 3)</div>
          {[1, 2, 3].map((i) => (
            <input
              key={i}
              name={`bullet_${i}`}
              required
              placeholder={["what the skill is", "why you want to learn it", "how you would learn it"][i - 1]}
              style={{ ...S.input, marginBottom: 10 }}
            />
          ))}

          <label style={S.label} htmlFor="closing">Closing line</label>
          <input
            id="closing"
            name="closing"
            required
            placeholder="and explain how this skill would help you."
            style={{ ...S.input, marginBottom: 18 }}
          />

          <label style={S.label} htmlFor="difficulty">Difficulty</label>
          <select id="difficulty" name="difficulty" defaultValue="2" style={{ ...S.select, marginBottom: 18 }}>
            <option value="">None</option>
            <option value="1">Foundation</option>
            <option value="2">Core</option>
            <option value="3">Stretch</option>
          </select>

          <div className="adm-grid3" style={S.grid3}>
            <div>
              <label style={S.label} htmlFor="prep_seconds">Prep (seconds)</label>
              <input id="prep_seconds" name="prep_seconds" type="number" min={15} max={120} step={5} defaultValue={60} style={S.input} />
            </div>
            <div>
              <label style={S.label} htmlFor="max_speak_seconds">Speak cap (seconds)</label>
              <input id="max_speak_seconds" name="max_speak_seconds" type="number" min={60} max={180} step={10} defaultValue={120} style={S.input} />
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
            <ConfirmButton name="intent" value="publish" icon="check" message="Publish this cue card live to students now?">
              Publish cue card
            </ConfirmButton>
            <SubmitButton name="intent" value="draft" variant="secondary">Save draft</SubmitButton>
            <span style={S.caption}>Draft → Published</span>
          </div>
        </form>

        <div style={S.listHead}>
          <h2 style={S.h2}>All cue cards</h2>
          <Badge tone="neutral">{tasks.length}</Badge>
        </div>

        {tasks.length === 0 ? (
          <p style={S.empty}>No cue cards yet — create one above to get started.</p>
        ) : (
          <ul style={S.list}>
            {tasks.map((t) => (
              <CueRow key={t.id} task={t} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

/**
 * One row in the cue-card list: the full cue-card preview (prompt + bullets + closing)
 * — which IS the publish confirmation — plus status/plan/timing badges and the
 * per-card actions. Each action is its own form so it carries only its own id.
 */
function CueRow({ task }: { task: AdminSpeakingTaskRow }) {
  const published = task.status === "published";
  const statusTone: BadgeTone = published ? "success" : "warn";
  return (
    <li style={S.row}>
      <div style={S.rowMain}>
        <p style={S.prompt}>{task.prompt}</p>
        {task.bullets.length > 0 && (
          <ul style={S.previewBullets}>
            {task.bullets.map((b, i) => (
              <li key={i} style={S.previewBullet}>
                <span style={S.previewDot} aria-hidden="true" />
                {b}
              </li>
            ))}
          </ul>
        )}
        <p style={S.closing}>{task.closingPrompt}</p>
        <div style={S.meta}>
          <Badge tone={statusTone}>{published ? "Published" : "Draft"}</Badge>
          <Badge tone="brand">Part 2</Badge>
          {task.difficulty && <Badge tone="neutral">{speakingDifficultyLabel[task.difficulty]}</Badge>}
          <Badge tone="brand">{TIER_LABEL[task.tierRequired]}</Badge>
          <Badge tone="neutral">{`Prep ${fmtClock(task.prepSeconds)}`}</Badge>
          <Badge tone="neutral">{`Cap ${fmtClock(task.maxSpeakSeconds)}`}</Badge>
        </div>
      </div>
      <div style={S.rowActions}>
        {published ? (
          <form action={unpublishSpeakingTask}>
            <input type="hidden" name="id" value={task.id} />
            <ConfirmButton size="sm" variant="secondary" message="Unpublish this cue card? Students will no longer see it in the catalog.">
              Unpublish
            </ConfirmButton>
          </form>
        ) : (
          <form action={publishSpeakingTask}>
            <input type="hidden" name="id" value={task.id} />
            <ConfirmButton size="sm" variant="success" icon="check" message="Publish this cue card live to students now?">
              Publish
            </ConfirmButton>
          </form>
        )}
        <form action={removeSpeakingTask}>
          <input type="hidden" name="id" value={task.id} />
          <ConfirmButton size="sm" variant="danger" icon="trash" message="Delete this cue card permanently? This cannot be undone.">
            Delete
          </ConfirmButton>
        </form>
      </div>
    </li>
  );
}

const S: Record<string, CSSProperties> = {
  page: { padding: "40px 18px 64px" },
  wrap: { maxWidth: 760, margin: "0 auto", fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  head: { display: "flex", alignItems: "center", gap: 12 },
  h1: { margin: 0, fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)" },
  sub: { margin: "8px 0 0", fontSize: "var(--text-sm)", color: "var(--text-muted)" },

  err: { marginTop: 16, padding: "12px 14px", borderRadius: "var(--radius-md)", background: "var(--error-subtle)", color: "var(--error-text)", fontSize: "var(--text-sm)", fontWeight: 600 },
  ok: { marginTop: 16, padding: "12px 14px", borderRadius: "var(--radius-md)", background: "var(--success-subtle)", color: "var(--success-text)", fontSize: "var(--text-sm)", fontWeight: 600 },

  card: { marginTop: 22, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 22, display: "flex", flexDirection: "column", gap: 8 },
  label: { fontSize: "var(--text-xs)", fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6, display: "block" },
  textarea: { width: "100%", resize: "vertical", minHeight: 60, background: "var(--surface-raised)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", lineHeight: 1.5, border: "2px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px", outline: "none", marginBottom: 18 },
  input: { width: "100%", height: 44, background: "var(--surface-raised)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", border: "2px solid var(--border)", borderRadius: "var(--radius-md)", padding: "0 12px", outline: "none" },
  grid3: { display: "grid", gap: 14, marginBottom: 18 },
  select: { width: "100%", height: 44, background: "var(--surface-raised)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", border: "2px solid var(--border)", borderRadius: "var(--radius-md)", padding: "0 12px", cursor: "pointer" },
  actions: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  caption: { fontSize: "var(--text-xs)", color: "var(--text-muted)" },

  listHead: { display: "flex", alignItems: "center", gap: 10, margin: "40px 0 14px" },
  h2: { margin: 0, fontSize: "var(--text-lg)", fontWeight: 800, letterSpacing: "var(--tracking-tight)" },
  empty: { margin: 0, padding: "22px 18px", background: "var(--surface)", border: "2px dashed var(--border)", borderRadius: "var(--radius-lg)", color: "var(--text-muted)", fontSize: "var(--text-sm)", textAlign: "center" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 },
  row: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 16 },
  rowMain: { flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 },
  // clamp: длинный cue-card-промпт больше не доминирует над строкой (полный текст — в превью ниже).
  prompt: { margin: 0, fontSize: "var(--text-base)", fontWeight: 700, lineHeight: 1.4, color: "var(--text-primary)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" },
  previewBullets: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 },
  previewBullet: { display: "flex", gap: 8, alignItems: "baseline", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },
  previewDot: { width: 5, height: 5, borderRadius: "50%", background: "var(--brand)", flex: "none" },
  closing: { margin: 0, fontSize: "var(--text-sm)", fontStyle: "italic", color: "var(--text-muted)" },
  meta: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 },
  rowActions: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" },
};
