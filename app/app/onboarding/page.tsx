import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { region } from "@/db/schema";
import { getProfile } from "@/lib/auth";
import OnboardingForm from "./OnboardingForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Onboarding | bando" };

/**
 * Post-signup onboarding (W1-2): capture display_name / region / target_band so
 * the dashboard band-distance, region leagues and a named leaderboard work from
 * day one. Focused full-screen (no AppShell). Already-onboarded users are sent
 * straight to the dashboard — this is a one-time gate.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/auth");
  if (profile.onboarded_at) redirect("/app");

  const { error } = await searchParams;

  // Region options — viloyat level, owner-path read (public territory names).
  const regions = await db
    .select({ id: region.id, name: region.name })
    .from(region)
    .where(eq(region.level, "region"))
    .orderBy(asc(region.name));

  return (
    <OnboardingForm
      regions={regions}
      error={error ?? null}
      defaultName={profile.display_name ?? ""}
    />
  );
}
