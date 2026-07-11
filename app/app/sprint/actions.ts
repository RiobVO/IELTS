"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/db";
import { profile, sprintSignup } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { captureServer } from "@/lib/analytics/server";

function fail(message: string): never {
  redirect(`/app/sprint?error=${encodeURIComponent(message)}`);
}

/**
 * Join the manual "exam sprint" pilot cohort (BRIEF §12.3). No automation here —
 * one cohort, the owner curates it by hand in Telegram. This action only links
 * user_id ↔ participation (retention measurement) and captures a Telegram handle
 * for the curator to reach out. Idempotent per user: unique(user_id) +
 * ON CONFLICT DO NOTHING, so a repeat submit (double-click, back-button) is a
 * silent no-op, not an error.
 */
export async function joinSprint(formData: FormData) {
  const user = await requireUser();

  const raw = String(formData.get("telegram_handle") ?? "").trim();
  // Optional single leading @ + 3–64 word chars; stored WITH the @ — same shape
  // it's echoed back in ("You're in" state), so display needs no reformatting.
  const match = /^@?([A-Za-z0-9_]{3,64})$/.exec(raw);
  if (!match) {
    fail("Enter a valid Telegram username (3–64 characters: letters, numbers, underscore).");
  }
  const telegramHandle = `@${match[1]}`;

  // Snapshot exam_date/target_band as of signup — the cohort is paced off what the
  // user had set at join time, not whatever the profile drifts to later.
  const [row] = await db
    .select({ examDate: profile.examDate, targetBand: profile.targetBand })
    .from(profile)
    .where(eq(profile.id, user.id))
    .limit(1);

  await db
    .insert(sprintSignup)
    .values({
      userId: user.id,
      telegramHandle,
      examDate: row?.examDate ?? null,
      targetBand: row?.targetBand ?? null,
    })
    .onConflictDoNothing({ target: sprintSignup.userId });

  // Best-effort telemetry off the response path (captureServer is already
  // fail-open + timeout-bounded; after() just keeps it from delaying the redirect).
  after(async () => captureServer("sprint_signup", user.id, {}));

  revalidatePath("/app/sprint");
  redirect("/app/sprint");
}
