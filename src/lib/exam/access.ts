/**
 * Exam access gate + attempt start (BRIEF §4.8 tier gating, §4.6 anti-cheat).
 *
 * SERVER-ONLY. The start path is split into explicit steps so the RSC exam/reading
 * pages can run the gate with the `profile` + `content_item` rows they ALREADY read
 * for rendering, instead of re-reading them. `submitAttempt` (a client-reachable
 * action) still calls loadAccessData/enforceAccess itself as defense-in-depth.
 *
 * SECURITY: `startAttempt` assumes access was ALREADY granted — every caller MUST
 * run `enforceAccess()` first. It is never exported as a Server Action and is only
 * reachable from server-trusted code (the RSC pages), so a forged tier can't reach
 * it over the network. The client-reachable paths (submitAttempt, /runner route)
 * keep their own gate.
 */
import "server-only";
import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import { attempt, contentItem, profile } from "@/db/schema";
import { captureServer } from "@/lib/analytics/server";
import { BASIC_DAILY_LIMIT, effectiveTier, meetsTier, type Tier } from "@/lib/tiers";

/** Режим попытки (P0): серверная сущность, выбирается ДО создания attempt. */
export type AttemptMode = "practice" | "mock";

/**
 * Read the access facts for (user, test) via the owner db: the user's effective
 * tier, the test's required tier, and the band scale (the last is submit-only but
 * read here so submit needs a SINGLE content_item round-trip, not two). Returns
 * null if either row is missing. No redirects — separated from enforcement so the
 * reads can be batched with submit's other independent queries.
 */
export async function loadAccessData(
  userId: string,
  contentItemId: string,
): Promise<{
  userTier: Tier;
  tierRequired: Tier;
  bandScale: Record<string, number> | null;
} | null> {
  const [[prof], [item]] = await Promise.all([
    db
      .select({ tier: profile.tier, premiumUntil: profile.premiumUntil })
      .from(profile)
      .where(eq(profile.id, userId)),
    db
      .select({
        tierRequired: contentItem.tierRequired,
        bandScale: contentItem.bandScale,
      })
      .from(contentItem)
      // Owner-path bypasses RLS, so gate published HERE too: a draft/unpublished id
      // never resolves -> caller redirects away. Keeps the start+submit gate from
      // being weaker than the catalog's content_item_select_published policy.
      .where(and(eq(contentItem.id, contentItemId), eq(contentItem.status, "published"))),
  ]);
  if (!prof || !item) return null;
  return {
    userTier: effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil }),
    tierRequired: item.tierRequired,
    bandScale: (item.bandScale as Record<string, number> | null) ?? null,
  };
}

/**
 * Enforce the §4.8 access gates (tier entitlement + Basic daily limit) for an
 * already-resolved effective tier. Redirects on denial. The single source of
 * truth for the gate logic, shared by exam-start and submit so a crafted submit
 * can't slip past — only the reads that feed it are batched by the caller.
 */
export async function enforceAccess(
  userId: string,
  userTier: Tier,
  tierRequired: Tier,
  /**
   * P0: дневной кап Basic считает и гейтит ТОЛЬКО СОЗДАНИЕ НОВОГО mock
   * (practice бесплатен и безлимитен; анти-абуз держит submit-throttle).
   * `null` = tier-гейт без капа — три легитимных случая: экран выбора режима
   * (mode ещё не выбран), резюм существующей попытки (новый слот не расходуется)
   * и submit (кап гейтит старты, не завершения — иначе доделанный mock терялся
   * бы на редиректе, у iframe-раннера ответы не автосейвятся).
   */
  mode: AttemptMode | null,
): Promise<void> {
  // (a) Tier gate — re-check entitlement against the test's required tier.
  if (!meetsTier(userTier, tierRequired)) redirect("/app/upgrade");

  // (b) Basic daily limit — count THIS user's submitted MOCK attempts in the
  // current UTC day. Premium/Ultra are unlimited, so only Basic pays the count
  // query; practice never does.
  if (userTier === "basic" && mode === "mock") {
    const now = new Date();
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [usage] = await db
      .select({ n: count() })
      .from(attempt)
      .where(
        and(
          eq(attempt.userId, userId),
          eq(attempt.mode, "mock"),
          eq(attempt.status, "submitted"),
          gte(attempt.submittedAt, dayStart),
          lt(attempt.submittedAt, dayEnd),
        ),
      );
    if ((usage?.n ?? 0) >= BASIC_DAILY_LIMIT) redirect("/app/practice?limit=1");
  }
}

/**
 * Незакрытая попытка этого (user, test) — страницы решают по ней, показывать ли
 * экран выбора режима (нет попытки и нет ?mode= → выбор) или резюмить с режимом,
 * зафиксированным при создании. Отдельный лёгкий SELECT по partial-индексу 0007,
 * батчится страницей с остальными независимыми чтениями.
 */
export async function findInProgressAttempt(
  userId: string,
  contentItemId: string,
): Promise<{ id: string; mode: AttemptMode } | null> {
  const [row] = await db
    .select({ id: attempt.id, mode: attempt.mode })
    .from(attempt)
    .where(
      and(
        eq(attempt.userId, userId),
        eq(attempt.contentItemId, contentItemId),
        eq(attempt.status, "in_progress"),
      ),
    )
    .orderBy(desc(attempt.startedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Была ли у юзера УЖЕ сданная попытка теста (любого режима). Нужна экрану выбора
 * режима для честности: first-attempt-only (§4.6) — повторный mock в рейтинг не
 * пойдёт, и юзер должен видеть это ДО старта, а не удивляться после.
 */
export async function hasSubmittedAttempt(
  userId: string,
  contentItemId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: attempt.id })
    .from(attempt)
    .where(
      and(
        eq(attempt.userId, userId),
        eq(attempt.contentItemId, contentItemId),
        eq(attempt.status, "submitted"),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Ensure an in_progress attempt exists for (user, test) and return its id + any
 * saved answers (BRIEF §4.3 autosave/resume). `started_at` is stamped SERVER-side
 * here — the single source of truth for elapsed time (§4.6 anti-cheat), never the
 * client. Idempotent: resumes the latest in_progress row instead of opening a
 * second one.
 *
 * SECURITY: assumes the caller has ALREADY run `enforceAccess()` — this function
 * does NOT gate tier/daily-limit. It is reachable only from the server-trusted RSC
 * pages (never a client-callable action), so the gate cannot be bypassed by calling
 * it directly.
 */
export async function startAttempt(
  userId: string,
  contentItemId: string,
  /** Режим НОВОЙ попытки; существующая in_progress резюмится со СВОИМ mode. */
  modeIfNew: AttemptMode,
): Promise<{
  attemptId: string;
  answers: Record<string, string | string[]>;
  mode: AttemptMode;
}> {
  const [existing] = await db
    .select({ id: attempt.id, answers: attempt.answers, mode: attempt.mode })
    .from(attempt)
    .where(
      and(
        eq(attempt.userId, userId),
        eq(attempt.contentItemId, contentItemId),
        eq(attempt.status, "in_progress"),
      ),
    )
    .orderBy(desc(attempt.startedAt))
    .limit(1);
  if (existing) {
    return {
      attemptId: existing.id,
      answers: (existing.answers as Record<string, string | string[]>) ?? {},
      mode: existing.mode,
    };
  }

  const inserted = await db
    .insert(attempt)
    .values({
      userId,
      contentItemId,
      mode: modeIfNew,
      status: "in_progress",
      answers: {},
      startedAt: new Date(), // SERVER time — authoritative for §4.6 timing
    })
    // 0007 partial unique index: at most one in_progress attempt per (user, test).
    // The loser of a concurrent first-start inserts nothing (resumed below).
    .onConflictDoNothing({
      target: [attempt.userId, attempt.contentItemId],
      where: sql`${attempt.status} = 'in_progress'`,
    })
    .returning({ id: attempt.id });

  // Lost the race: another call created the in_progress row first — resume IT,
  // don't open a second one and don't double-fire test_start.
  if (inserted.length === 0) {
    const [winner] = await db
      .select({ id: attempt.id, answers: attempt.answers, mode: attempt.mode })
      .from(attempt)
      .where(
        and(
          eq(attempt.userId, userId),
          eq(attempt.contentItemId, contentItemId),
          eq(attempt.status, "in_progress"),
        ),
      )
      .orderBy(desc(attempt.startedAt))
      .limit(1);
    if (winner) {
      return {
        attemptId: winner.id,
        answers: (winner.answers as Record<string, string | string[]>) ?? {},
        mode: winner.mode,
      };
    }
    // Vanishingly rare: the winner's row was submitted between the conflict and
    // this read, so no in_progress row exists now. Re-enter the page so the next
    // startAttempt opens a fresh attempt cleanly.
    redirect(`/app/reading/${contentItemId}`);
  }

  // We created the attempt -> test_start (§11), exactly once per real start. Both
  // the meta lookup (needed ONLY for the event props) and the PostHog flush are
  // deferred to after() so they never block the user-facing start — capture is
  // best-effort telemetry, not part of the response. distinctId stays
  // server-authoritative (userId).
  after(async () => {
    const [meta] = await db
      .select({
        section: contentItem.section,
        category: contentItem.category,
        tierRequired: contentItem.tierRequired,
      })
      .from(contentItem)
      .where(eq(contentItem.id, contentItemId));
    await captureServer("test_start", userId, {
      content_item_id: contentItemId,
      section: meta?.section ?? "",
      category: meta?.category ?? "",
      tier_required: meta?.tierRequired ?? "",
      mode: modeIfNew,
    });
  });

  return { attemptId: inserted[0]!.id, answers: {}, mode: modeIfNew };
}
