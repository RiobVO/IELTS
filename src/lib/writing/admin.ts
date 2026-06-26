import { eq } from "drizzle-orm";
import { db } from "@/db";
import { writingTask } from "@/db/schema";
import type { Tier } from "@/lib/tiers";

// Admin writes for Writing Lab topics. Owner path; the route gates with
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

export async function publishWritingTask(taskId: string): Promise<void> {
  await db.update(writingTask).set({ status: "published" }).where(eq(writingTask.id, taskId));
}
