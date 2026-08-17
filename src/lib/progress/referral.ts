/**
 * Referral reward engine (BRIEF §4.9 / §11 anti-abuse). Runs once, server-side,
 * from the post-submit hook: rewards an invitee's referral ONLY after a RATED
 * first attempt (anti-farm), and EXACTLY once.
 *
 * Anti-farm tightening (§11): the reward requires `rated` — i.e. a genuine first
 * attempt that wasn't an instant too-fast submit (same floor-guard as Elo). A
 * too-fast/garbage submit no longer claims the referral; the `registered` row
 * stays and a later genuine rated submit claims it. Without this, an invitee
 * could farm the inviter's reward by instantly submitting an empty test.
 *
 * SERVER-ONLY. Uses the Drizzle owner client (`@/db`, bypasses RLS): granting
 * the inviter's XP and inserting notifications for another user are privileged
 * writes that RLS (owner-read on `referral`, owner-scoped `profile`) would block.
 *
 * Single-fire is guaranteed by the atomic claim: the `UPDATE referral SET
 * status='rewarded' ... WHERE status='registered'` transitions the row in one
 * statement, so concurrent submits race on the same row and only one wins the
 * RETURNING. Self-referral and invalid codes are already excluded upstream by
 * the signup trigger (no `registered` row is ever created for them).
 *
 * The claim and BOTH XP grants run in ONE transaction. Otherwise a crash between
 * the (already-committed) claim and the XP writes would leave status='rewarded'
 * with no XP — and the single-fire guard makes that unrecoverable on retry. The
 * notifications stay OUTSIDE the transaction (genuinely best-effort).
 *
 * BEST-EFFORT: the whole body is wrapped so this NEVER throws — the caller
 * (applyPostSubmit) redirects immediately after, and a reward failure must not
 * break the submit, only skip the perk.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { notification, profile, referral } from "@/db/schema";
import { logError } from "@/lib/monitoring/log-error";

/**
 * OAuth signup gap-fill (Google — Apple/Facebook not wired yet, BRIEF §12.1 п.3):
 * the `handle_new_user` DB trigger (migration 0005) links a referral from
 * `raw_user_meta_data ->> 'ref_code'`, which the email signup form supplies but
 * Google's OAuth exchange never does (Google populates that metadata from the
 * user's Google profile, not our app). AuthScreen's googleSignIn now carries
 * `ref` through the OAuth `redirectTo` URL instead; the callback route calls
 * this to perform the SAME linking the trigger would have done, for a fresh
 * OAuth signup only.
 *
 * Mirrors migrations/0005_referral_linking/up.sql exactly: self-referral
 * blocked, idempotent (the trigger's WHERE NOT EXISTS has no app-code
 * equivalent, so migration 0053 adds a real UNIQUE(invitee_id) constraint —
 * onConflictDoNothing below targets it), referral insert failure never
 * propagates (non-essential perk). Does NOT reward — that stays
 * maybeRewardReferral's job, fired later from applyPostSubmit.
 *
 * Claim + insert run in ONE transaction (review finding): two separate
 * statements let referred_by and the referral row's inviter disagree — e.g.
 * a losing concurrent call's UPDATE affects 0 rows (referred_by already set)
 * but its INSERT would still fire with the WRONG inviter, or a mid-flight
 * failure between the two leaves referred_by set with no referral row (dead
 * invite, no reward ever possible). Gating the INSERT on the UPDATE's own
 * `returning()` means only the call that actually won the referred_by claim
 * ever inserts — same shape as maybeRewardReferral's atomic claim below.
 */
export async function linkOAuthReferral(
  userId: string,
  refCode: string,
): Promise<void> {
  const code = refCode.trim();
  if (!code) return;
  try {
    const [inviter] = await db
      .select({ id: profile.id })
      .from(profile)
      .where(eq(profile.referralCode, code))
      .limit(1);
    if (!inviter || inviter.id === userId) return; // не найден / self-referral

    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(profile)
        .set({ referredBy: inviter.id })
        .where(and(eq(profile.id, userId), isNull(profile.referredBy)))
        .returning({ id: profile.id });
      if (claimed.length === 0) return; // уже привязан (эта или другая гонка) — не трогаем referral

      await tx
        .insert(referral)
        .values({
          inviterId: inviter.id,
          inviteeId: userId,
          code: randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase(),
          status: "registered",
        })
        .onConflictDoNothing({ target: referral.inviteeId });
    });
  } catch (e) {
    await logError({
      source: "server",
      message: `linkOAuthReferral failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      userId,
    });
  }
}

export async function maybeRewardReferral(
  userId: string,
  rated: boolean,
): Promise<void> {
  // Anti-farm: только RATED первая попытка триггерит награду. Не-rated (too-fast
  // или ретейк) НЕ забирает 'registered'-строку — её заберёт позднейший
  // настоящий rated-сабмит. Ранний выход ДО claim, иначе строка бы «сгорела».
  if (!rated) return;
  try {
    // Claim + grant in one transaction: the status flip and both XP increments
    // commit or roll back together, so the reward can never be marked 'rewarded'
    // without the XP actually landing (and vice versa).
    const inviterId = await db.transaction(async (tx) => {
      // Atomically claim the reward. The WHERE status='registered' + RETURNING is
      // the single-fire guard: only the first submit that finds the row in
      // 'registered' flips it to 'rewarded' and gets a row back. The row lock the
      // UPDATE takes also serializes concurrent first-submits inside the txn.
      const claimed = await tx
        .update(referral)
        .set({ status: "rewarded", reward: "xp:inviter=100,invitee=50" })
        .where(
          and(eq(referral.inviteeId, userId), eq(referral.status, "registered")),
        )
        .returning({ inviterId: referral.inviterId });

      // No pending referral for this user, or it was already rewarded.
      if (claimed.length === 0) return null;

      // Grant XP via a SQL increment (read-modify-write in JS would race the
      // post-submit profile write that also touches xp). Inviter +100, invitee +50.
      await tx
        .update(profile)
        .set({ xp: sql`${profile.xp} + 100` })
        .where(eq(profile.id, claimed[0].inviterId));
      await tx
        .update(profile)
        .set({ xp: sql`${profile.xp} + 50` })
        .where(eq(profile.id, userId));

      return claimed[0].inviterId;
    });

    // No pending referral was claimed — nothing to announce.
    if (inviterId === null) return;

    // Notifications are nice-to-have: each in its own try/catch so a failure
    // here never undoes the XP grant above. notification.type has no referral
    // value, so use 'system' (per the 2C contract).
    try {
      await db.insert(notification).values({
        userId: inviterId,
        type: "system",
        kind: "referral",
        title: "Referral activated",
        body: "Your friend completed their first test — you earned +100 XP",
      });
    } catch (e) {
      await logError({
        source: "server",
        message: `maybeRewardReferral: inviter notification failed: ${e instanceof Error ? e.message : String(e)}`,
        userId: inviterId,
      });
    }

    try {
      await db.insert(notification).values({
        userId,
        type: "system",
        kind: "referral",
        title: "Welcome",
        body: "You earned +50 XP for signing up via an invite",
      });
    } catch (e) {
      await logError({
        source: "server",
        message: `maybeRewardReferral: invitee notification failed: ${e instanceof Error ? e.message : String(e)}`,
        userId,
      });
    }
  } catch (e) {
    await logError({
      source: "server",
      message: `maybeRewardReferral failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      userId,
    });
    return;
  }
}
