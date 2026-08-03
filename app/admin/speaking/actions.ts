"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { coerceDifficulty } from "@/lib/speaking/catalog-meta";
import { deleteSpeakingTask, insertSpeakingTask, setTaskStatus } from "@/lib/speaking/admin";
import type { Tier } from "@/lib/tiers";

const TIERS: readonly string[] = ["basic", "premium", "ultra"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Prep/speak bounds: a Part 2 prep is ~1 min, the long-turn 1–2 min. Clamp to sane
// ranges so a stray form value can't produce a 0-second prep or a 10-minute cap.
const PREP_MIN = 15, PREP_MAX = 120;
const SPEAK_MIN = 60, SPEAK_MAX = 180;

function clampInt(raw: FormDataEntryValue | null, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(String(raw ?? "").trim()));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function readTaskId(formData: FormData): string {
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) {
    redirect(`/admin/speaking?error=${encodeURIComponent("Unknown cue card.")}`);
  }
  return id;
}

/**
 * Create a Speaking Lab Part 2 cue-card. Owner-only (requireAdmin). Validates the
 * cue-card shape: a non-empty prompt + closing and EXACTLY three "you should say"
 * bullets (the IELTS Part 2 format). "Publish" inserts as published; "Save draft" as
 * draft — students see it in the catalog only once published.
 */
export async function createSpeakingTask(formData: FormData) {
  const admin = await requireAdmin();
  const prompt = String(formData.get("prompt") ?? "").trim();
  const closingPrompt = String(formData.get("closing") ?? "").trim();
  const bullets = [1, 2, 3]
    .map((i) => String(formData.get(`bullet_${i}`) ?? "").trim())
    .filter(Boolean);

  if (!prompt || !closingPrompt) {
    redirect(`/admin/speaking?error=${encodeURIComponent("A prompt and a closing line are required.")}`);
  }
  if (bullets.length !== 3) {
    redirect(`/admin/speaking?error=${encodeURIComponent("Exactly three “you should say” bullets are required.")}`);
  }

  const tierRaw = String(formData.get("tier") ?? "ultra");
  const tier: Tier = TIERS.includes(tierRaw) ? (tierRaw as Tier) : "ultra";
  const prepSeconds = clampInt(formData.get("prep_seconds"), 60, PREP_MIN, PREP_MAX);
  const maxSpeakSeconds = clampInt(formData.get("max_speak_seconds"), 120, SPEAK_MIN, SPEAK_MAX);
  const difficulty = coerceDifficulty(formData.get("difficulty"));
  const publish = formData.get("intent") === "publish";

  await insertSpeakingTask({
    prompt,
    bullets,
    closingPrompt,
    prepSeconds,
    maxSpeakSeconds,
    tierRequired: tier,
    difficulty,
    createdBy: admin.id,
    publish,
  });
  redirect(`/admin/speaking?created=${publish ? "published" : "draft"}`);
}

/** Owner-only. Make a draft cue-card live in the catalog. */
export async function publishSpeakingTask(formData: FormData) {
  await requireAdmin();
  const id = readTaskId(formData);
  await setTaskStatus(id, "published");
  redirect("/admin/speaking?done=published");
}

/** Owner-only. Pull a cue-card out of the catalog back to draft. */
export async function unpublishSpeakingTask(formData: FormData) {
  await requireAdmin();
  const id = readTaskId(formData);
  await setTaskStatus(id, "draft");
  redirect("/admin/speaking?done=unpublished");
}

/** Owner-only. Hard-delete — refused (→ unpublish) when a student has already submitted. */
export async function removeSpeakingTask(formData: FormData) {
  await requireAdmin();
  const id = readTaskId(formData);
  const result = await deleteSpeakingTask(id);
  if (!result.deleted) {
    redirect(`/admin/speaking?error=${encodeURIComponent("This cue card has submissions — unpublish instead.")}`);
  }
  redirect("/admin/speaking?done=deleted");
}
