import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
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
    // Published-only: owner-path bypasses RLS, so a draft id must notFound() here
    // too (parity with the catalog's content_item_select_published policy).
    .where(and(eq(contentItem.id, id), eq(contentItem.status, "published")));
  if (!test?.runnerHtml) notFound();

  // Старт/resume attempt (server-stamped started_at, tier+daily-limit гейт внутри).
  const { attemptId } = await ensureAttempt(id);

  return <ExamFrame attemptId={attemptId} contentItemId={id} />;
}
