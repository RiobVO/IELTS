"use server";

import { eq } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { contentItem } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { parseTest } from "@/lib/import/parse-test";
import { persistTest, RegradeRequiredError } from "@/lib/import/persist";

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
    fail("Выберите HTML-файл теста.");
  }
  const html = await file.text();

  let summary: { title: string; questions: number; warnings: number };
  try {
    const parsed = parseTest(html);
    await persistTest(parsed, {
      sourceFilePath: file.name,
      createdBy: profile.id,
    });
    summary = {
      title: parsed.title,
      questions: parsed.questions.length,
      warnings: parsed.warnings.length,
    };
  } catch (e) {
    if (e instanceof RegradeRequiredError) {
      console.error("admin uploadTest refused — test has attempts", e);
      fail(
        `У теста уже есть попытки (${e.attemptCount}) — повторный импорт удалил бы их. ` +
          `Правка пройденного теста появится с Re-grade.`,
      );
    }
    console.error("admin uploadTest failed", e);
    fail("Не удалось обработать файл (парсинг или сохранение).");
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
