import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { writingFeedback, writingSubmission, writingTask } from "@/db/schema";
import type { Feedback } from "./evaluator/types";
import { task1ImageUrl } from "./storage";
import {
  coerceDifficulty,
  coerceTaskType,
  coerceTopic,
  type WritingDifficulty,
  type WritingTaskType,
  type WritingTopic,
} from "./topic-meta";

// UI reads for Writing Lab. Owner path (Drizzle, RLS-bypassing), the same trust
// model as the reading result page: ownership is enforced in the WHERE clause
// (user_id = the caller). NEVER selects writing_feedback_debug (server-only raw).

export interface CatalogTask {
  id: string;
  category: "academic" | "general";
  taskPart: "task1" | "task2";
  imageUrl: string | null; // public Storage URL of the Task 1 visual; null for Task 2
  prompt: string;
  topic: WritingTopic | null;
  taskType: WritingTaskType | null;
  difficulty: WritingDifficulty | null;
  bandLow: number | null;
  bandHigh: number | null;
}

const CATALOG_COLUMNS = {
  id: writingTask.id,
  category: writingTask.category,
  taskPart: writingTask.taskPart,
  imagePath: writingTask.imagePath,
  prompt: writingTask.prompt,
  topic: writingTask.topic,
  taskType: writingTask.taskType,
  difficulty: writingTask.difficulty,
  bandLow: writingTask.bandLow,
  bandHigh: writingTask.bandHigh,
} as const;

type CatalogRow = {
  id: string;
  category: "academic" | "general";
  taskPart: "task1" | "task2";
  imagePath: string | null;
  prompt: string;
  topic: string | null;
  taskType: string | null;
  difficulty: number | null;
  bandLow: string | null;
  bandHigh: string | null;
};

// Narrow the raw text/numeric columns to the typed catalog shape. Unknown topic /
// type (shouldn't happen — DB CHECK pins them) coerces to null → neutral card.
function toCatalogTask(row: CatalogRow): CatalogTask {
  return {
    id: row.id,
    category: row.category,
    taskPart: row.taskPart,
    imageUrl: task1ImageUrl(row.imagePath),
    prompt: row.prompt,
    topic: coerceTopic(row.topic),
    taskType: coerceTaskType(row.taskType),
    difficulty: coerceDifficulty(row.difficulty),
    bandLow: row.bandLow != null ? Number(row.bandLow) : null,
    bandHigh: row.bandHigh != null ? Number(row.bandHigh) : null,
  };
}

export async function listPublishedTasks(): Promise<CatalogTask[]> {
  const rows = await db
    .select(CATALOG_COLUMNS)
    .from(writingTask)
    .where(eq(writingTask.status, "published"))
    .orderBy(desc(writingTask.createdAt));
  return rows.map(toCatalogTask);
}

export async function loadPublishedTask(taskId: string): Promise<CatalogTask | null> {
  const [row] = await db
    .select(CATALOG_COLUMNS)
    .from(writingTask)
    .where(and(eq(writingTask.id, taskId), eq(writingTask.status, "published")))
    .limit(1);
  return row ? toCatalogTask(row) : null;
}

export interface FeedbackResult {
  essay: string;
  wordCount: number;
  taskPrompt: string;
  category: "academic" | "general";
  taskPart: "task1" | "task2";
  imageUrl: string | null;
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
      taskPart: writingTask.taskPart,
      imagePath: writingTask.imagePath,
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
    taskPart: row.taskPart,
    imageUrl: task1ImageUrl(row.imagePath),
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
