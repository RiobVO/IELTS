import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { speakingFeedback, speakingSubmission, speakingTask } from "@/db/schema";
import type { Tier } from "@/lib/tiers";
import { coerceDifficulty, detectCategory, type SpeakingCategory, type SpeakingDifficulty } from "./catalog-meta";
import type { Feedback } from "./evaluator/types";
import type { TranscriptTiming } from "./transcript-align";

type SpeakingCriterion = Feedback["criteria"][number];
type SpeakingAnnotation = Feedback["annotations"][number];
type SpeakingRewrite = Feedback["rewrites"][number];

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
  // Presentational Part 2 bucket derived from the prompt (no DB column) — gives the
  // catalog cards a per-card identity + theme colour. See catalog-meta.ts.
  category: SpeakingCategory;
  // Human-set difficulty (0031); null until an admin assigns one → meter hidden.
  difficulty: SpeakingDifficulty | null;
}

const TASK_COLUMNS = {
  id: speakingTask.id,
  prompt: speakingTask.prompt,
  bullets: speakingTask.bullets,
  closingPrompt: speakingTask.closingPrompt,
  prepSeconds: speakingTask.prepSeconds,
  maxSpeakSeconds: speakingTask.maxSpeakSeconds,
  tierRequired: speakingTask.tierRequired,
  difficulty: speakingTask.difficulty,
} as const;

type TaskRow = {
  id: string;
  prompt: string;
  bullets: unknown;
  closingPrompt: string;
  prepSeconds: number;
  maxSpeakSeconds: number;
  tierRequired: Tier;
  difficulty: number | null;
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
    category: detectCategory(row.prompt),
    difficulty: coerceDifficulty(row.difficulty),
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

export interface SpeakingFeedbackResult {
  submissionId: string;
  taskPrompt: string;
  createdAt: Date;
  bandLow: number;
  bandHigh: number;
  confidence: "low" | "medium" | "high";
  // Wiped to "" / [] only when the USER deletes the recording (verbatim speech is
  // PII) — the band + criteria + drills stay. Retention deletes the AUDIO after a
  // successful eval window but KEEPS the transcript, so "removed" is gated on the
  // transcript being empty, never on audio deletion. The UI swaps to "removed".
  transcript: string;
  // Sentence-level sync timings ([] when STT was unconfigured, or wiped with the
  // transcript on a user delete). The result page karaoke-highlights the transcript
  // against the <audio> only when this is non-empty AND the audio still exists.
  transcriptTimings: TranscriptTiming[];
  // Storage key of the take while it still exists (null once audio is deleted — user
  // delete or the 7-day retention reaper). The result page signs a short-lived GET URL
  // from this so the owner can replay; null → no player. Never sent to the client.
  audioPath: string | null;
  criteria: SpeakingCriterion[];
  topFixes: string[];
  annotations: SpeakingAnnotation[];
  // "Say it stronger" pairs (#1). [] on short/no-speech or after a user delete (the
  // `original` lines are verbatim speech = PII). The result page hides the block if empty.
  rewrites: SpeakingRewrite[];
  drills: string[];
}

/** Owner-scoped: only the submission's owner, only once feedback exists (completed). */
export async function readFeedbackResult(
  userId: string,
  submissionId: string,
): Promise<SpeakingFeedbackResult | null> {
  const [row] = await db
    .select({
      submissionId: speakingFeedback.submissionId,
      taskPrompt: speakingTask.prompt,
      createdAt: speakingFeedback.createdAt,
      bandLow: speakingFeedback.bandLow,
      bandHigh: speakingFeedback.bandHigh,
      confidence: speakingFeedback.confidence,
      transcript: speakingFeedback.transcript,
      transcriptTimings: speakingFeedback.transcriptTimings,
      audioPath: speakingSubmission.audioPath,
      audioDeletedAt: speakingSubmission.audioDeletedAt,
      criteria: speakingFeedback.criteria,
      topFixes: speakingFeedback.topFixes,
      annotations: speakingFeedback.annotations,
      rewrites: speakingFeedback.rewrites,
      drills: speakingFeedback.drills,
    })
    .from(speakingFeedback)
    .innerJoin(speakingSubmission, eq(speakingSubmission.id, speakingFeedback.submissionId))
    .innerJoin(speakingTask, eq(speakingTask.id, speakingSubmission.taskId))
    .where(and(eq(speakingFeedback.submissionId, submissionId), eq(speakingSubmission.userId, userId)))
    .limit(1);
  if (!row) return null;
  return {
    submissionId: row.submissionId,
    taskPrompt: row.taskPrompt,
    createdAt: row.createdAt,
    bandLow: Number(row.bandLow),
    bandHigh: Number(row.bandHigh),
    confidence: row.confidence,
    transcript: row.transcript,
    transcriptTimings: (row.transcriptTimings as TranscriptTiming[] | null) ?? [],
    audioPath: row.audioDeletedAt != null ? null : row.audioPath,
    criteria: row.criteria as SpeakingCriterion[],
    topFixes: row.topFixes as string[],
    annotations: row.annotations as SpeakingAnnotation[],
    rewrites: (row.rewrites as SpeakingRewrite[] | null) ?? [],
    drills: row.drills as string[],
  };
}

export interface SpeakingHistoryRow {
  submissionId: string;
  prompt: string;
  createdAt: Date;
  bandLow: number;
  bandHigh: number;
  confidence: "low" | "medium" | "high";
  audioDeleted: boolean;
}

/** Owner-scoped completed attempts (a feedback row exists), newest first. */
export async function listUserHistory(userId: string): Promise<SpeakingHistoryRow[]> {
  const rows = await db
    .select({
      submissionId: speakingFeedback.submissionId,
      prompt: speakingTask.prompt,
      createdAt: speakingFeedback.createdAt,
      bandLow: speakingFeedback.bandLow,
      bandHigh: speakingFeedback.bandHigh,
      confidence: speakingFeedback.confidence,
      audioDeletedAt: speakingSubmission.audioDeletedAt,
    })
    .from(speakingFeedback)
    .innerJoin(speakingSubmission, eq(speakingSubmission.id, speakingFeedback.submissionId))
    .innerJoin(speakingTask, eq(speakingTask.id, speakingSubmission.taskId))
    .where(eq(speakingSubmission.userId, userId))
    .orderBy(desc(speakingFeedback.createdAt));
  return rows.map((r) => ({
    submissionId: r.submissionId,
    prompt: r.prompt,
    createdAt: r.createdAt,
    bandLow: Number(r.bandLow),
    bandHigh: Number(r.bandHigh),
    confidence: r.confidence,
    audioDeleted: r.audioDeletedAt != null,
  }));
}
