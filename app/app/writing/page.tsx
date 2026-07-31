import { redirect } from "next/navigation";
import { getProfile, requireUser } from "@/lib/auth";
import { writingEvalConfig } from "@/env";
import { listPublishedTasks } from "@/lib/writing/read";
import { AppShell } from "../_AppShell";
import { WritingCatalog } from "./_Catalog";

export const dynamic = "force-dynamic";

/**
 * Writing Lab catalog (`/app/writing`). Disabled-safe: with WRITING_EVAL_MODEL
 * unset the feature is off → redirect to Practice (the Soon/locked-panel there is
 * the coming-soon state). Otherwise list published Task 2 prompts owner-path.
 */
export default async function WritingCatalogPage() {
  await requireUser();
  if (writingEvalConfig() === null) redirect("/app/practice");

  const [profile, tasks] = await Promise.all([getProfile(), listPublishedTasks()]);
  const rawTarget = (profile as { target_band: string | number | null } | null)?.target_band;
  const targetBand = rawTarget != null ? Number(rawTarget) : null;

  return (
    <AppShell active="practice">
      <WritingCatalog tasks={tasks} targetBand={targetBand} />
    </AppShell>
  );
}
