import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { speakingSubmission, speakingTask } from "@/db/schema";
import { coerceDifficulty, type SpeakingDifficulty } from "./catalog-meta";
import type { Tier } from "@/lib/tiers";

// Admin reads/writes for Speaking Lab cue-cards. Owner path; the route gates with
// requireAdmin. Publish is a deliberate status flip (draft → published) after the
// admin reviews the typed cue-card in the list — mirrors writing/admin.ts.

export async function insertSpeakingTask(input: {
  prompt: string;
  bullets: string[];
  closingPrompt: string;
  prepSeconds: number;
  maxSpeakSeconds: number;
  tierRequired: Tier;
  difficulty: SpeakingDifficulty | null;
  createdBy: string;
  publish: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(speakingTask)
    .values({
      prompt: input.prompt,
      bullets: input.bullets,
      closingPrompt: input.closingPrompt,
      prepSeconds: input.prepSeconds,
      maxSpeakSeconds: input.maxSpeakSeconds,
      tierRequired: input.tierRequired,
      difficulty: input.difficulty,
      status: input.publish ? "published" : "draft",
      createdBy: input.createdBy,
    })
    .returning({ id: speakingTask.id });
  return row.id;
}

export interface AdminSpeakingTaskRow {
  id: string;
  prompt: string;
  bullets: string[];
  closingPrompt: string;
  prepSeconds: number;
  maxSpeakSeconds: number;
  tierRequired: Tier;
  difficulty: SpeakingDifficulty | null;
  status: "draft" | "published";
  createdAt: Date;
}

/** Every cue-card — draft and published — for the admin panel. Route-gated by requireAdmin. */
export async function listAllTasks(): Promise<AdminSpeakingTaskRow[]> {
  const rows = await db
    .select({
      id: speakingTask.id,
      prompt: speakingTask.prompt,
      bullets: speakingTask.bullets,
      closingPrompt: speakingTask.closingPrompt,
      prepSeconds: speakingTask.prepSeconds,
      maxSpeakSeconds: speakingTask.maxSpeakSeconds,
      tierRequired: speakingTask.tierRequired,
      difficulty: speakingTask.difficulty,
      status: speakingTask.status,
      createdAt: speakingTask.createdAt,
    })
    .from(speakingTask)
    .orderBy(desc(speakingTask.createdAt));
  return rows.map((r) => ({
    ...r,
    bullets: Array.isArray(r.bullets) ? (r.bullets as string[]) : [],
    difficulty: coerceDifficulty(r.difficulty),
  }));
}

/** Flip a cue-card's catalog visibility: publish (draft→published) or unpublish. */
export async function setTaskStatus(taskId: string, status: "draft" | "published"): Promise<void> {
  await db.update(speakingTask).set({ status }).where(eq(speakingTask.id, taskId));
}

export interface DeleteTaskResult {
  deleted: boolean;
  hasSubmissions: boolean;
}

/**
 * Hard-delete a cue-card — ONLY when no student has submitted against it. A card
 * linked to a speaking_submission is left intact (hasSubmissions:true); the caller
 * offers unpublish instead, so students' attempts/feedback are never cascaded away.
 */
export async function deleteSpeakingTask(taskId: string): Promise<DeleteTaskResult> {
  const [sub] = await db
    .select({ id: speakingSubmission.id })
    .from(speakingSubmission)
    .where(eq(speakingSubmission.taskId, taskId))
    .limit(1);
  if (sub) return { deleted: false, hasSubmissions: true };

  await db.delete(speakingTask).where(eq(speakingTask.id, taskId));
  return { deleted: true, hasSubmissions: false };
}
