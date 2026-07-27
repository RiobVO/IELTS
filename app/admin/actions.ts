"use server";

import { eq } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { contentItem } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { RegradeRequiredError } from "@/lib/import/persist";
import { importRunner } from "@/lib/import/runner/import-runner";

function fail(message: string): never {
  redirect(`/admin?error=${encodeURIComponent(message)}`);
}

/**
 * Admin HTML upload (BRIEF §4.2.1): the browser equivalent of `npm run import`.
 * Parses the uploaded test deterministically and persists it as `draft` (the
 * admin reviews + publishes afterwards). Owner-only (requireAdmin); persistTest
 * uses the owner db (writes answer_key, RLS-bypassed) — server-only.
 */
export async function uploadTest(formData: FormData) {
  const profile = await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    fail("Select an HTML test file.");
  }
  const html = await file.text();

  let summary: { title: string; questions: number; warnings: number };
  try {
    const r = await importRunner(html, {
      sourceFilePath: file.name,
      createdBy: profile.id,
    });
    summary = { title: r.title, questions: r.questions, warnings: r.warnings };
  } catch (e) {
    if (e instanceof RegradeRequiredError) {
      console.error("admin uploadTest refused — test has attempts", e);
      fail(
        `This test already has attempts (${e.attemptCount}) — re-importing would delete them. ` +
          `Editing a sat test will be available via Re-grade.`,
      );
    }
    console.error("admin uploadTest failed", e);
    fail("Could not process the file (parsing or saving).");
  }

  // A re-import can change a published test's data — invalidate the catalog cache.
  revalidateTag("content_item");
  revalidatePath("/admin");
  redirect(
    `/admin?${new URLSearchParams({
      uploaded: summary.title,
      q: String(summary.questions),
      w: String(summary.warnings),
    }).toString()}`,
  );
}

/**
 * Flip a content item between draft and published (BRIEF §4.2.1 — admin confirms
 * the key before students can see it). Owner-only.
 */
export async function setStatus(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || (status !== "draft" && status !== "published")) redirect("/admin");
  await db
    .update(contentItem)
    .set({ status })
    .where(eq(contentItem.id, id));
  // Catalog's published list is cached by tag — publish/unpublish invalidates it.
  revalidateTag("content_item");
  revalidatePath("/admin");
  redirect("/admin");
}
