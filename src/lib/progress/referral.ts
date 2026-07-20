/**
 * Referral reward engine (BRIEF §4.9 / §11 anti-abuse). Runs once, server-side,
 * from the post-submit hook: rewards an invitee's referral ONLY after they have
 * completed >= 1 test, and EXACTLY once.
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
 * BEST-EFFORT: the whole body is wrapped so this NEVER throws — the caller
 * (applyPostSubmit) redirects immediately after, and a reward failure must not
 * break the submit, only skip the perk.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { notification, profile, referral } from "@/db/schema";

export async function maybeRewardReferral(userId: string): Promise<void> {
  try {
    // Atomically claim the reward. The WHERE status='registered' + RETURNING is
    // the single-fire guard: only the first submit that finds the row in
    // 'registered' flips it to 'rewarded' and gets a row back.
    const claimed = await db
      .update(referral)
      .set({ status: "rewarded", reward: "xp:inviter=100,invitee=50" })
      .where(
        and(eq(referral.inviteeId, userId), eq(referral.status, "registered")),
      )
      .returning({ inviterId: referral.inviterId });

    // No pending referral for this user, or it was already rewarded.
    if (claimed.length === 0) return;

    const inviterId = claimed[0].inviterId;

    // Grant XP atomically (read-modify-write would race the post-submit profile
    // write that also touches xp). Inviter +100, invitee +50.
    await db
      .update(profile)
      .set({ xp: sql`${profile.xp} + 100` })
      .where(eq(profile.id, inviterId));
    await db
      .update(profile)
      .set({ xp: sql`${profile.xp} + 50` })
      .where(eq(profile.id, userId));

    // Notifications are nice-to-have: each in its own try/catch so a failure
    // here never undoes the XP grant above. notification.type has no referral
    // value, so use 'system' (per the 2C contract).
    try {
      await db.insert(notification).values({
        userId: inviterId,
        type: "system",
        title: "Реферал активирован",
        body: "Твой друг сдал первый тест — тебе +100 XP",
      });
    } catch (e) {
      console.error("maybeRewardReferral: inviter notification failed", e);
    }

    try {
      await db.insert(notification).values({
        userId,
        type: "system",
        title: "Добро пожаловать",
        body: "Тебе +50 XP за регистрацию по приглашению",
      });
    } catch (e) {
      console.error("maybeRewardReferral: invitee notification failed", e);
    }
  } catch (e) {
    console.error("maybeRewardReferral failed", e);
    return;
  }
}
