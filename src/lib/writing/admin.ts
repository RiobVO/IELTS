import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { writingSubmission, writingTask } from "@/db/schema";
import type { Tier } from "@/lib/tiers";

// Admin reads/writes for Writing Lab topics. Owner path; the route gates with
// requireAdmin. Publish is a deliberate status flip (draft → published), not a
// blind toggle — the admin form shows the typed prompt before submit.

export async function insertWritingTask(input: {
  category: "academic" | "general";
  prompt: string;
  tierRequired: Tier;
  createdBy: string;
  publish: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(writingTask)
    .values({
      category: input.category,
      prompt: input.prompt,
      tierRequired: input.tierRequired,
      status: input.publish ? "published" : "draft",
      createdBy: input.createdBy,
    })
    .returning({ id: writingTask.id });
  return row.id;
}

export interface AdminTaskRow {
  id: string;
  prompt: string;
  category: "academic" | "general";
  tierRequired: Tier;
  status: "draft" | "published";
  createdAt: Date;
}

/** Every topic — draft and published — for the admin panel. Route-gated by requireAdmin. */
export async function listAllTasks(): Promise<AdminTaskRow[]> {
  return db
    .select({
      id: writingTask.id,
      prompt: writingTask.prompt,
      category: writingTask.category,
      tierRequired: writingTask.tierRequired,
      status: writingTask.status,
      createdAt: writingTask.createdAt,
    })
    .from(writingTask)
    .orderBy(desc(writingTask.createdAt));
}

/** Flip a topic's catalog visibility: publish (draft→published) or unpublish (published→draft). */
export async function setTaskStatus(taskId: string, status: "draft" | "published"): Promise<void> {
  await db.update(writingTask).set({ status }).where(eq(writingTask.id, taskId));
}

export interface DeleteTaskResult {
  deleted: boolean;
  hasSubmissions: boolean;
}

/**
 * Hard-delete a topic — ONLY when no student has submitted against it. A topic
 * linked to at least one writing_submission is left intact (hasSubmissions:true);
 * the caller offers unpublish instead, so students' essays/feedback are never
 * cascaded away by an admin's delete.
 */
export async function deleteWritingTask(taskId: string): Promise<DeleteTaskResult> {
  const [sub] = await db
    .select({ id: writingSubmission.id })
    .from(writingSubmission)
    .where(eq(writingSubmission.taskId, taskId))
    .limit(1);
  if (sub) return { deleted: false, hasSubmissions: true };

  await db.delete(writingTask).where(eq(writingTask.id, taskId));
  return { deleted: true, hasSubmissions: false };
}
