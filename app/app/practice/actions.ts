"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { captureServer } from "@/lib/analytics/server";

/**
 * Inline re-target from the Practice hub (`profile.target_band`). SERVER-ONLY via
 * the Drizzle owner client — profile writes are revoked from the authenticated
 * role (migration 0010), so we update owner-side, scoped to the caller's own id
 * (requireUser), never a client-supplied id. Mirrors completeOnboarding's guard.
 *
 * Silent no-op on an out-of-range value (the <select> only offers 4.0–9.0 in 0.5
 * steps; this just refuses anything a tampered client could send).
 */
export async function setTargetBand(band: string): Promise<void> {
  const user = await requireUser();

  const value = Number(band);
  // Valid IELTS target: 4.0–9.0 in 0.5 steps (band*2 must be a whole number).
  if (!Number.isFinite(value) || value < 4 || value > 9 || (value * 2) % 1 !== 0) {
    return;
  }

  await db
    .update(profile)
    // numeric column → Drizzle expects a string.
    .set({ targetBand: value.toFixed(1) })
    .where(eq(profile.id, user.id));

  // target_band виден не только в GoalBar каталога: band-план дашборда, target-бейдж
  // Overview (/app/progress) и профиль читают то же поле — перечисляем все поверхности.
  revalidatePath("/app/practice");
  revalidatePath("/app");
  revalidatePath("/app/progress");
  revalidatePath("/app/profile");
}

/**
 * Waitlist для пустого каталога (контент-вайп, BRIEF §12.3): пока библиотека
 * пополняется, собираем спрос вместо тупика. Никакой таблицы — только
 * PostHog-телеметрия (как joinPaymentWaitlist в app/upgrade/actions.ts);
 * best-effort — вызывающая сторона глушит ошибку, состояние кнопки не откатывает.
 */
export async function joinContentWaitlist(): Promise<void> {
  const user = await requireUser();
  await captureServer("content_waitlist", user.id, { source: "catalog" });
}
