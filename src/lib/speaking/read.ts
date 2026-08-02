import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { speakingTask } from "@/db/schema";
import type { Tier } from "@/lib/tiers";

// UI reads for Speaking Lab. Owner path (Drizzle) — same trust model as the Writing
// reads and the rest of the Speaking backend (store.ts): ownership is enforced in
// the WHERE clause where it matters. Published cue-cards are public content, so the
// catalog reads need no user scope. NEVER selects speaking_feedback_debug (raw output).

export interface SpeakingCatalogTask {
  id: string;
  prompt: string;
  bullets: string[];
  closingPrompt: string;
  prepSeconds: number;
  maxSpeakSeconds: number;
  tierRequired: Tier;
}

const TASK_COLUMNS = {
  id: speakingTask.id,
  prompt: speakingTask.prompt,
  bullets: speakingTask.bullets,
  closingPrompt: speakingTask.closingPrompt,
  prepSeconds: speakingTask.prepSeconds,
  maxSpeakSeconds: speakingTask.maxSpeakSeconds,
  tierRequired: speakingTask.tierRequired,
} as const;

type TaskRow = {
  id: string;
  prompt: string;
  bullets: unknown;
  closingPrompt: string;
  prepSeconds: number;
  maxSpeakSeconds: number;
  tierRequired: Tier;
};

function toCatalogTask(row: TaskRow): SpeakingCatalogTask {
  return {
    id: row.id,
    prompt: row.prompt,
    bullets: Array.isArray(row.bullets) ? (row.bullets as string[]) : [],
    closingPrompt: row.closingPrompt,
    prepSeconds: row.prepSeconds,
    maxSpeakSeconds: row.maxSpeakSeconds,
    tierRequired: row.tierRequired,
  };
}

/** Published cue-cards, newest first — the catalog grid. */
export async function listPublishedTasks(): Promise<SpeakingCatalogTask[]> {
  const rows = await db
    .select(TASK_COLUMNS)
    .from(speakingTask)
    .where(eq(speakingTask.status, "published"))
    .orderBy(desc(speakingTask.createdAt));
  return rows.map(toCatalogTask);
}

/** One published cue-card by id, or null (the attempt screen's task source). */
export async function loadPublishedTask(taskId: string): Promise<SpeakingCatalogTask | null> {
  const [row] = await db
    .select(TASK_COLUMNS)
    .from(speakingTask)
    .where(and(eq(speakingTask.id, taskId), eq(speakingTask.status, "published")))
    .limit(1);
  return row ? toCatalogTask(row) : null;
}
