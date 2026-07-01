"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { contentItem } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { RegradeRequiredError } from "@/lib/import/persist";
import { importRunner } from "@/lib/import/runner/import-runner";
import { publishReviewedContentItem } from "@/lib/content/publish";

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

  let summary: { title: string; questions: number; warnings: number; brand: string };
  try {
    const r = await importRunner(html, {
      sourceFilePath: file.name,
      createdBy: profile.id,
    });
    summary = {
      title: r.title,
      questions: r.questions,
      warnings: r.warnings,
      brand: r.brandWarnings.join("; "),
    };
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
      ...(summary.brand ? { brand: summary.brand } : {}),
    }).toString()}`,
  );
}

/**
 * Flip a content item between draft and published (BRIEF §4.2.1 — admin confirms
 * the key before students can see it). Owner-only.
 *
 * Review gate: publishing requires a prior `markReviewed` (reviewed_at set). The
 * admin UI hides Publish until approved, but enforce it here too — the action is
 * reachable by POST regardless of the page. Unpublishing (→ draft) is unguarded.
 */
export async function setStatus(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || (status !== "draft" && status !== "published")) redirect("/admin");

  if (status === "published") {
    // Shared chokepoint: publishes only if reviewed_at is set (and revalidates the
    // catalog tag). Keeps the review gate identical across the admin UI and the bot.
    const res = await publishReviewedContentItem(id);
    if (!res.ok) {
      if (res.reason === "not_reviewed") {
        fail("Approve the import (review the key) before publishing.");
      }
      if (res.reason === "empty_answer_key") {
        fail("Can't publish: a question has an empty answer key — fix the import first.");
      }
      if (res.reason === "unresolved_question_type") {
        fail("Can't publish: a question type didn't resolve (see the parser warnings) — fix the import first.");
      }
      redirect("/admin"); // not_found
    }
  } else {
    // Unpublishing (→ draft) is intentionally unguarded.
    await db.update(contentItem).set({ status: "draft" }).where(eq(contentItem.id, id));
    // Catalog's published list is cached by tag — unpublish invalidates it.
    revalidateTag("content_item");
  }
  revalidatePath("/admin");
  redirect("/admin");
}

/**
 * Approve an imported draft (BRIEF §4.2.1 — admin confirms the answer key before
 * students see it). Stamps reviewed_at so publishing is unlocked. Owner-only. A
 * re-import replaces the row, so reviewed_at resets and re-approval is required.
 */
export async function markReviewed(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin");
  await db
    .update(contentItem)
    .set({ reviewedAt: sql`now()` })
    .where(eq(contentItem.id, id));
  revalidatePath("/admin");
  redirect("/admin");
}
