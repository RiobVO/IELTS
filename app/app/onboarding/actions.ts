"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { captureServer } from "@/lib/analytics/server";
import { logError } from "@/lib/monitoring/log-error";
import { validExamDate } from "@/lib/progress/exam-countdown";
import { QUESTION_TYPES } from "@/lib/import/question-types";

function fail(message: string): never {
  redirect(`/app/onboarding?error=${encodeURIComponent(message)}`);
}

/**
 * F9: санитизация мини-диагностики (OnboardingForm hidden-поля diag_*). Клиент шлёт
 * их напрямую, не через типизированный server action — значит мусор (подделанная
 * форма, руками отправленный POST) не должен ронять completeOnboarding, только
 * молча не породить событие. `diag_total` отсутствует (поле не существовало на
 * сабмите — юзер нажал "Skip for now" до диагностики) → null, событие не шлём.
 */
function sanitizeDiagnostic(formData: FormData): { correct: number; total: number; weak_type: string } | null {
  const totalField = formData.get("diag_total");
  if (totalField === null) return null;
  const totalRaw = Number(totalField);
  if (!Number.isFinite(totalRaw)) return null;
  // Диагностика фиксированно 6 вопросов; клэмп до 0..10 — запас на будущее, не жёсткое "=6".
  const total = Math.min(10, Math.max(0, Math.trunc(totalRaw)));
  const correctRaw = Number(formData.get("diag_correct"));
  const correct = Number.isFinite(correctRaw) ? Math.min(total, Math.max(0, Math.trunc(correctRaw))) : 0;
  const weakTypeRaw = String(formData.get("diag_weak_type") ?? "").trim();
  const weak_type = (QUESTION_TYPES as readonly string[]).includes(weakTypeRaw) ? weakTypeRaw : "";
  return { correct, total, weak_type };
}

/**
 * Persist the post-signup onboarding (W1-2): display_name, region, target_band,
 * and stamp onboarded_at. SERVER-ONLY via the Drizzle owner client — profile
 * writes are revoked from the authenticated role (migration 0010), so the page
 * cannot write the row directly; we update it owner-side, scoped to the caller's
 * own id (requireUser), never a client-supplied id.
 */
export async function completeOnboarding(formData: FormData) {
  const user = await requireUser();

  const displayName = String(formData.get("display_name") ?? "").trim();
  const regionId = String(formData.get("region_id") ?? "").trim();
  const targetBand = String(formData.get("target_band") ?? "").trim();
  const examDateRaw = String(formData.get("exam_date") ?? "").trim();

  if (displayName.length < 2 || displayName.length > 40) {
    fail("Enter a display name (2–40 characters).");
  }
  const band = Number(targetBand);
  // Valid IELTS target: 4.0–9.0 in 0.5 steps (band*2 must be a whole number).
  if (!Number.isFinite(band) || band < 4 || band > 9 || (band * 2) % 1 !== 0) {
    fail("Pick a target band.");
  }
  // exam_date is optional — an invalid/out-of-range value is dropped silently
  // (null) rather than failing onboarding over a non-essential field.
  const examDate = validExamDate(examDateRaw) ? examDateRaw : null;

  try {
    await db
      .update(profile)
      .set({
        displayName,
        // numeric column → Drizzle expects a string; empty select → no region.
        regionId: regionId === "" ? null : regionId,
        targetBand: band.toFixed(1),
        examDate,
        onboardedAt: new Date(),
      })
      .where(eq(profile.id, user.id));
  } catch (e) {
    // A bad region_id (not in the region table) trips the FK; surface it instead
    // of a 500. Everything else is logged and reported generically.
    await logError({
      source: "server",
      message: "completeOnboarding failed",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "completeOnboarding", userId: user.id },
    });
    fail("Could not save your profile. Try again.");
  }

  // F9: результат мини-диагностики (если пройдена — hidden-поля пришли непустыми).
  const diagnostic = sanitizeDiagnostic(formData);

  // onboarding_complete — событие воронки (§11), best-effort в after() (как test_start),
  // не блокирует редирект. display_name не шлём (PII). onboarding_diagnostic_complete —
  // отдельным событием РЯДОМ, чтобы weak_type первого касания попал в аналитику ещё до
  // первого реального теста; шлём только если диагностика реально пройдена (не Skip).
  after(async () => {
    await captureServer("onboarding_complete", user.id, { target_band: band, has_region: regionId !== "" });
    if (diagnostic) {
      await captureServer("onboarding_diagnostic_complete", user.id, diagnostic);
    }
  });

  revalidatePath("/app", "layout");
  redirect("/app");
}
