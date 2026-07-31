"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { deleteWritingTask, insertWritingTask, setTaskStatus } from "@/lib/writing/admin";
import type { Tier } from "@/lib/tiers";

const TIERS: readonly string[] = ["basic", "premium", "ultra"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read a well-formed topic id from the form, or bail to the panel with an error.
 * Guards the per-row actions against a malformed/missing id reaching Postgres as a
 * uuid cast (which would 500) — returns only after the format check passes.
 */
function readTaskId(formData: FormData): string {
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) {
    redirect(`/admin/writing?error=${encodeURIComponent("Unknown topic.")}`);
  }
  return id;
}

/**
 * Create a Writing Lab Task 2 topic. Owner-only (requireAdmin). "Publish topic"
 * inserts as published, "Save draft" as draft — a deliberate confirm of the typed
 * prompt, not a blind flip. Students see it in the catalog only once published.
 */
export async function createWritingTask(formData: FormData) {
  const admin = await requireAdmin();
  const prompt = String(formData.get("prompt") ?? "").trim();
  const category = String(formData.get("category") ?? "");
  const tierRaw = String(formData.get("tier") ?? "ultra");
  const tier: Tier = TIERS.includes(tierRaw) ? (tierRaw as Tier) : "ultra";
  const publish = formData.get("intent") === "publish";

  if (!prompt || (category !== "academic" && category !== "general")) {
    redirect(`/admin/writing?error=${encodeURIComponent("A prompt and a valid category are required.")}`);
  }

  await insertWritingTask({ prompt, category, tierRequired: tier, createdBy: admin.id, publish });
  redirect(`/admin/writing?created=${publish ? "published" : "draft"}`);
}

/** Owner-only. Make a draft topic live in the catalog. */
export async function publishTask(formData: FormData) {
  await requireAdmin();
  const id = readTaskId(formData);
  await setTaskStatus(id, "published");
  redirect("/admin/writing?done=published");
}

/** Owner-only. Pull a topic out of the catalog back to draft — the safe "remove" for topics with submissions. */
export async function unpublishTask(formData: FormData) {
  await requireAdmin();
  const id = readTaskId(formData);
  await setTaskStatus(id, "draft");
  redirect("/admin/writing?done=unpublished");
}

/** Owner-only. Hard-delete a topic — refused (→ unpublish) when a student has already submitted against it. */
export async function removeTask(formData: FormData) {
  await requireAdmin();
  const id = readTaskId(formData);
  const result = await deleteWritingTask(id);
  if (!result.deleted) {
    redirect(`/admin/writing?error=${encodeURIComponent("This topic has submissions — unpublish instead.")}`);
  }
  redirect("/admin/writing?done=deleted");
}
