"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { validExamDate } from "@/lib/progress/exam-countdown";

/**
 * Inline exam-date edit from the dashboard countdown card (`profile.exam_date`).
 * SERVER-ONLY via the Drizzle owner client — profile writes are revoked from the
 * authenticated role (migration 0010), so we update owner-side, scoped to the
 * caller's own id (requireUser). Mirrors setTargetBand's guard
 * (app/app/practice/actions.ts).
 *
 * `raw` empty → clears the date (null). Invalid/out-of-range → silent no-op
 * (same "don't fail on a soft field" stance as onboarding's exam_date parsing).
 */
export async function updateExamDate(raw: unknown): Promise<void> {
  // Runtime type-guard: server action вызывается с клиента, TS-тип аргумента —
  // не валидация; нестроковый payload = silent no-op, как и невалидная дата.
  if (typeof raw !== "string") return;
  const user = await requireUser();

  const value = raw.trim();
  if (value !== "" && !validExamDate(value)) return;

  await db
    .update(profile)
    .set({ examDate: value === "" ? null : value })
    .where(eq(profile.id, user.id));

  revalidatePath("/app");
}
