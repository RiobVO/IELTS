import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { writingFeedback, writingSubmission, writingTask } from "@/db/schema";
import type { Feedback } from "./evaluator/types";

// UI reads for Writing Lab. Owner path (Drizzle, RLS-bypassing), the same trust
// model as the reading result page: ownership is enforced in the WHERE clause
// (user_id = the caller). NEVER selects writing_feedback_debug (server-only raw).

export interface CatalogTask {
  id: string;
  category: "academic" | "general";
  prompt: string;
}

export async function listPublishedTasks(): Promise<CatalogTask[]> {
  return db
    .select({ id: writingTask.id, category: writingTask.category, prompt: writingTask.prompt })
    .from(writingTask)
    .where(eq(writingTask.status, "published"))
    .orderBy(desc(writingTask.createdAt));
}

export async function loadPublishedTask(taskId: string): Promise<CatalogTask | null> {
  const [row] = await db
    .select({ id: writingTask.id, category: writingTask.category, prompt: writingTask.prompt })
    .from(writingTask)
    .where(and(eq(writingTask.id, taskId), eq(writingTask.status, "published")))
    .limit(1);
  return row ?? null;
}

export interface FeedbackResult {
  essay: string;
  wordCount: number;
  taskPrompt: string;
  category: "academic" | "general";
  createdAt: Date;
  bandLow: number;
  bandHigh: number;
  confidence: "low" | "medium" | "high";
  feedback: Pick<Feedback, "criteria" | "topFixes" | "annotations" | "rewrite" | "checklist">;
}

/** Owner-scoped: only the submission's owner, only once feedback exists (completed). */
export async function readFeedbackResult(
  userId: string,
  submissionId: string,
): Promise<FeedbackResult | null> {
  const [row] = await db
    .select({
      essay: writingSubmission.essayText,
      wordCount: writingSubmission.wordCount,
      taskPrompt: writingTask.prompt,
      category: writingTask.category,
      createdAt: writingFeedback.createdAt,
      bandLow: writingFeedback.bandLow,
      bandHigh: writingFeedback.bandHigh,
      confidence: writingFeedback.confidence,
      criteria: writingFeedback.criteria,
      topFixes: writingFeedback.topFixes,
      annotations: writingFeedback.annotations,
      rewrite: writingFeedback.rewrite,
      checklist: writingFeedback.checklist,
    })
    .from(writingFeedback)
    .innerJoin(writingSubmission, eq(writingSubmission.id, writingFeedback.submissionId))
    .innerJoin(writingTask, eq(writingTask.id, writingSubmission.taskId))
    .where(and(eq(writingFeedback.submissionId, submissionId), eq(writingSubmission.userId, userId)))
    .limit(1);
  if (!row) return null;
  return {
    essay: row.essay,
    wordCount: row.wordCount,
    taskPrompt: row.taskPrompt,
    category: row.category,
    createdAt: row.createdAt,
    bandLow: Number(row.bandLow),
    bandHigh: Number(row.bandHigh),
    confidence: row.confidence,
    feedback: {
      criteria: row.criteria as Feedback["criteria"],
      topFixes: row.topFixes as Feedback["topFixes"],
      annotations: row.annotations as Feedback["annotations"],
      rewrite: row.rewrite as Feedback["rewrite"],
      checklist: row.checklist as Feedback["checklist"],
    },
  };
}

export interface HistoryRow {
  submissionId: string;
  category: "academic" | "general";
  prompt: string;
  createdAt: Date;
  bandLow: number;
  bandHigh: number;
  confidence: "low" | "medium" | "high";
}

export async function listUserHistory(userId: string): Promise<HistoryRow[]> {
  const rows = await db
    .select({
      submissionId: writingFeedback.submissionId,
      category: writingTask.category,
      prompt: writingTask.prompt,
      createdAt: writingFeedback.createdAt,
      bandLow: writingFeedback.bandLow,
      bandHigh: writingFeedback.bandHigh,
      confidence: writingFeedback.confidence,
    })
    .from(writingFeedback)
    .innerJoin(writingSubmission, eq(writingSubmission.id, writingFeedback.submissionId))
    .innerJoin(writingTask, eq(writingTask.id, writingSubmission.taskId))
    .where(eq(writingSubmission.userId, userId))
    .orderBy(desc(writingFeedback.createdAt));
  return rows.map((r) => ({ ...r, bandLow: Number(r.bandLow), bandHigh: Number(r.bandHigh) }));
}
