import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contentItem } from "@/db/schema";
import { ensureAttempt } from "../../reading/[id]/actions";
import ExamFrame from "./ExamFrame";

export default async function ExamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [test] = await db
    .select({ id: contentItem.id, runnerHtml: contentItem.runnerHtml })
    .from(contentItem)
    .where(eq(contentItem.id, id));
  if (!test?.runnerHtml) notFound();

  // Старт/resume attempt (server-stamped started_at, tier+daily-limit гейт внутри).
  const { attemptId } = await ensureAttempt(id);

  return <ExamFrame attemptId={attemptId} contentItemId={id} />;
}
