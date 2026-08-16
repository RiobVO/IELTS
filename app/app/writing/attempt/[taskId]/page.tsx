import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getProfile, requireUser } from "@/lib/auth";
import { getHeaderData } from "@/lib/notifications/header-data";
import { db } from "@/db";
import { writingTask } from "@/db/schema";
import { writingFeatureEnabled } from "@/env";
import { isUuid } from "@/lib/uuid";
import { coerceTopic, writingTopicLabel } from "@/lib/writing/topic-meta";
import { loadPublishedTask } from "@/lib/writing/read";
import { AppShell } from "../../../_AppShell";
import { Attempt } from "./_Attempt";

export const dynamic = "force-dynamic";

// Динамический title вкладки — тема+часть задания вместо статичного дефолта. Чистый
// read-only запрос (без loadPublishedTask/writingFeatureEnabled): generateMetadata не
// должна триггерить редиректы/бизнес-гейты самой страницы (принцип reading/[id]).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ taskId: string }>;
}): Promise<Metadata> {
  const { taskId } = await params;
  if (!isUuid(taskId)) return { title: "Writing practice | bando" };
  // Published-гейт — тот же, что у loadPublishedTask (writing/read.ts): draft-задание
  // не должно светить topic в <title> вкладки раньше собственного notFound страницы.
  const [row] = await db
    .select({ topic: writingTask.topic, taskPart: writingTask.taskPart })
    .from(writingTask)
    .where(and(eq(writingTask.id, taskId), eq(writingTask.status, "published")))
    .limit(1);
  if (!row) return { title: "Writing practice | bando" };
  const topic = coerceTopic(row.topic);
  const partLabel = row.taskPart === "task1" ? "Task 1" : "Task 2";
  const title = topic ? `${writingTopicLabel[topic]} — ${partLabel}` : `Writing ${partLabel}`;
  return { title: `${title} | bando` };
}

/**
 * Attempt screen (`/app/writing/attempt/[taskId]`). Disabled-safe redirect to
 * Practice; 404 on a bad/unpublished task. Loads the prompt owner-path and hands
 * the async write→evaluate→poll flow to the client component.
 */
export default async function AttemptPage({ params }: { params: Promise<{ taskId: string }> }) {
  await requireUser();
  if (!writingFeatureEnabled()) redirect("/app/practice");
  // Пре-варм данных шапки конкурентно (cache()'d; AppShell reuses).
  void getHeaderData();

  const { taskId } = await params;
  if (!isUuid(taskId)) notFound();

  const [profile, task] = await Promise.all([getProfile(), loadPublishedTask(taskId)]);
  if (!task) notFound();

  const rawTarget = (profile as { target_band: string | number | null } | null)?.target_band;
  const targetBand = rawTarget != null ? Number(rawTarget) : 7;

  return (
    <AppShell active="practice">
      <Attempt task={task} targetBand={targetBand} />
    </AppShell>
  );
}
