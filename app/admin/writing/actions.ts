"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { deleteWritingTask, insertWritingTask, setTaskStatus } from "@/lib/writing/admin";
import {
  coerceDifficulty,
  coerceTaskType,
  coerceTopic,
  detectTaskType,
  detectTopic,
} from "@/lib/writing/topic-meta";
import { TASK1_IMAGE_MIME, uploadTask1Image } from "@/lib/writing/storage";
import type { Tier } from "@/lib/tiers";

const TIERS: readonly string[] = ["basic", "premium", "ultra"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // mirrors the bucket's fileSizeLimit
const MIME_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/**
 * Upload the Task 1 visual and return its Storage key, or redirect with an error
 * when the file is missing/oversized/not a supported raster image. Task 1 is graded
 * by COMPARING the essay to this image, so a Task 1 topic without one is rejected.
 */
async function uploadTaskImage(formData: FormData): Promise<string> {
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/admin/writing?error=${encodeURIComponent("Task 1 needs a chart image.")}`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    redirect(`/admin/writing?error=${encodeURIComponent("Image too large (max 3 MB).")}`);
  }
  const ext = MIME_EXT[file.type];
  if (!ext || !(TASK1_IMAGE_MIME as readonly string[]).includes(file.type)) {
    redirect(`/admin/writing?error=${encodeURIComponent("Image must be PNG, JPEG or WebP.")}`);
  }
  return uploadTask1Image(`${crypto.randomUUID()}.${ext}`, await file.arrayBuffer(), file.type);
}

/** Parse a band field to a 0–9 value at 0.5 resolution, or null when blank/invalid. */
function parseBand(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 9) return null;
  return Math.round(n * 2) / 2;
}

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
  const tierRaw = String(formData.get("tier") ?? "ultra");
  const tier: Tier = TIERS.includes(tierRaw) ? (tierRaw as Tier) : "ultra";
  const publish = formData.get("intent") === "publish";
  const taskPart = formData.get("task_part") === "task1" ? "task1" : "task2";
  // Task 1 in this lab is Academic only (chart description); GT Task 1 letters are
  // out of scope. Task 2 keeps the admin's category choice.
  const categoryRaw = String(formData.get("category") ?? "");
  const category = taskPart === "task1" ? "academic" : categoryRaw;

  if (!prompt || (category !== "academic" && category !== "general")) {
    redirect(`/admin/writing?error=${encodeURIComponent("A prompt and a valid category are required.")}`);
  }

  // Upload the visual BEFORE the insert so a bad image fails fast (no orphan row).
  // Task 2 carries no image.
  const imagePath = taskPart === "task1" ? await uploadTaskImage(formData) : null;

  // "auto" runs the heuristic over the prompt text; an explicit value is stored as
  // chosen; "" leaves the column null (the catalog renders a neutral card). Topic
  // heuristics are Task 2 stems — for Task 1 leave them unset unless explicitly chosen.
  const topicRaw = String(formData.get("topic") ?? "auto");
  const topic =
    topicRaw === "auto" ? (taskPart === "task1" ? null : detectTopic(prompt)) : coerceTopic(topicRaw);
  const typeRaw = String(formData.get("task_type") ?? "auto");
  const taskType =
    typeRaw === "auto" ? (taskPart === "task1" ? null : detectTaskType(prompt)) : coerceTaskType(typeRaw);
  const difficulty = coerceDifficulty(formData.get("difficulty"));
  const bandLow = parseBand(formData.get("band_low"));
  const bandHigh = parseBand(formData.get("band_high"));

  await insertWritingTask({
    prompt,
    category,
    taskPart,
    imagePath,
    topic,
    taskType,
    difficulty,
    bandLow,
    bandHigh,
    tierRequired: tier,
    createdBy: admin.id,
    publish,
  });
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
