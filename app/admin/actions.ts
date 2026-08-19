"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import { contentItem } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { contentTag } from "@/lib/content/exam-content";
import { triggerL1Generation } from "@/lib/content/l1/store";
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

  let summary: { id: string; title: string; questions: number; warnings: number; brand: string };
  try {
    const r = await importRunner(html, {
      sourceFilePath: file.name,
      createdBy: profile.id,
    });
    summary = {
      id: r.id,
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

  // Kick off L1 (RU) explanation generation for the freshly imported draft — best-effort,
  // deferred past the redirect (mirrors onboarding_complete's after()). No-op if the
  // feature isn't configured (l1FeatureEnabled() gates inside triggerL1Generation).
  after(() => triggerL1Generation(summary.id));

  // A re-import can change a published test's data — invalidate the catalog cache
  // (content_item) and this test's per-id content caches (getExamContent/getContentMeta).
  revalidateTag("content_item");
  revalidateTag(contentTag(summary.id));
  revalidatePath("/admin");
  redirect(
    `/admin?${new URLSearchParams({
      uploaded: summary.title,
      q: String(summary.questions),
      w: String(summary.warnings),
      ...(summary.brand ? { brand: summary.brand } : {}),
    }).toString()}#${summary.id}`,
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
      // F14-мин: detail (номера/факт. число, уже посчитанные гейтом) приклеиваем к
      // статическому тексту причины — без него «дыра в номерах» не говорит, в каких.
      const withDetail = (msg: string) => (res.detail ? `${msg} (${res.detail})` : msg);
      if (res.reason === "not_reviewed") {
        fail(withDetail("Approve the import (review the key) before publishing."));
      }
      if (res.reason === "empty_answer_key") {
        fail(withDetail("Can't publish: a question has an empty answer key — fix the import first."));
      }
      if (res.reason === "unresolved_question_type") {
        fail(
          withDetail(
            "Can't publish: a question type is empty or unresolved — add QTYPE per the authoring spec " +
              "and re-upload the file.",
          ),
        );
      }
      if (res.reason === "question_number_gap") {
        fail(withDetail("Can't publish: question numbers have a gap or duplicate — fix the import first."));
      }
      if (res.reason === "answer_key_count_mismatch") {
        fail(withDetail("Can't publish: a question is missing its answer key — fix the import first."));
      }
      if (res.reason === "missing_listening_audio") {
        fail(withDetail("Can't publish: this listening test has no audio yet — attach the mp3 first."));
      }
      if (res.reason === "full_missing_band_scale") {
        fail(withDetail("Can't publish: a full test needs a band scale table (getBandFor40) — fix the import first."));
      }
      if (res.reason === "full_wrong_question_count") {
        fail(withDetail("Can't publish: a full test must have exactly 40 questions — fix the import first."));
      }
      redirect("/admin"); // not_found
    }
  } else {
    // Unpublishing (→ draft) is intentionally unguarded.
    await db.update(contentItem).set({ status: "draft" }).where(eq(contentItem.id, id));
    // Catalog's published list is cached by tag — unpublish invalidates it, plus
    // this test's per-id content caches (getExamContent now returns null for it).
    revalidateTag("content_item");
    revalidateTag(contentTag(id));
  }
  revalidatePath("/admin");
  // done/did — тост «Undo» на затронутой строке; #id — якорь, чтобы не прыгать наверх.
  redirect(`/admin?done=${status}&did=${id}#${id}`);
}

/**
 * Bulk-approve или bulk-publish выбранных драфтов (power-user: разгребать пачку
 * импортов из Telegram без построчного клика). Approve — один update reviewed_at по
 * inArray. Publish гоним КАЖДЫЙ через тот же guarded chokepoint (publishReviewedContentItem),
 * поэтому review-gate держится: непроверенные/невалидные молча пропускаются, а не уходят
 * студентам. Owner-only.
 */
export async function bulkSetStatus(formData: FormData) {
  await requireAdmin();
  const intent = String(formData.get("intent") ?? "");
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length === 0 || (intent !== "approve" && intent !== "publish")) redirect("/admin");

  if (intent === "approve") {
    await db.update(contentItem).set({ reviewedAt: sql`now()` }).where(inArray(contentItem.id, ids));
    revalidatePath("/admin");
    redirect(`/admin?bulk=${encodeURIComponent(`Approved ${ids.length} test(s).`)}`);
  }

  let ok = 0;
  const skipped: string[] = [];
  for (const id of ids) {
    const res = await publishReviewedContentItem(id);
    if (res.ok) ok++;
    else skipped.push(id);
  }
  revalidateTag("content_item");
  revalidatePath("/admin");
  const msg = skipped.length
    ? `Published ${ok} test(s); skipped ${skipped.length} (not approved or invalid).`
    : `Published ${ok} test(s).`;
  redirect(`/admin?bulk=${encodeURIComponent(msg)}`);
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
  // #id — якорь на затронутую строку, чтобы редирект не сбрасывал скролл наверх.
  redirect(`/admin#${id}`);
}

/**
 * Re-run L1 (RU) explanation generation for one test (admin review screen).
 *
 * Из терминального статуса (pending/done/failed): reset → pending + немедленный
 * триггер. Из 'generating' триггер НЕ запускается — иначе два прогона пишут
 * вперемешку и старый может выставить done поверх нового (гонка без поколений
 * claim'а). Вместо этого залипший 'generating' (упавшая/потерянная Vercel-функция)
 * force-reset'ится в 'failed' БЕЗ триггера: к повторному клику админа старый прогон
 * гарантированно мёртв (function timeout << человеческая реакция), и обычная ветка
 * запускает чистый прогон. Publish от l1_status не зависит.
 *
 * Известный остаточный риск (не закрыт): если этот force-reset выполнится, пока
 * ДЕЙСТВИТЕЛЬНО ещё живой прогон вот-вот успешно завершится, финальный markL1Status
 * того прогона (guarded WHERE l1Status='generating') найдёт статус уже 'failed' и
 * не применится — объяснения при этом персистятся полностью и корректно (persistL1
 * ничем не гейтится), просто бирка статуса разойдётся с реальным покрытием на один
 * клик. UI (page.tsx) прячет кнопку Regenerate, пока статус 'generating', что
 * закрывает обычный сценарий двойного клика; полная защита потребовала бы токена
 * поколения прогона — непропорционально стоимости чисто косметического расхождения.
 */
export async function regenerateL1(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin");
  const claimed = await db
    .update(contentItem)
    .set({ l1Status: "pending" })
    .where(and(eq(contentItem.id, id), ne(contentItem.l1Status, "generating")))
    .returning({ id: contentItem.id });
  if (claimed.length > 0) {
    await triggerL1Generation(id);
  } else {
    // Был 'generating' — только расстопориваем; следующий клик запустит прогон.
    await db
      .update(contentItem)
      .set({ l1Status: "failed" })
      .where(and(eq(contentItem.id, id), eq(contentItem.l1Status, "generating")));
  }
  revalidatePath("/admin");
  redirect(`/admin#${id}`);
}
