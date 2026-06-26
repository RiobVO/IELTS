"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { insertWritingTask } from "@/lib/writing/admin";
import type { Tier } from "@/lib/tiers";

const TIERS: readonly string[] = ["basic", "premium", "ultra"];

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
