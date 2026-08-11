import { NextResponse } from "next/server";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { notification, profile, vocabCard, vocabDeck, vocabProgress } from "@/db/schema";
import { effectiveTier, meetsTier } from "@/lib/tiers";
import { cronSecret } from "@/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logError } from "@/lib/monitoring/log-error";
import { createNotifications, type NewNotification } from "@/lib/notifications/create";

export const dynamic = "force-dynamic";

const VOCAB_DUE_REMINDER_TYPE = "system" as const;
const VOCAB_DUE_REMINDER_KIND = "vocab_due_reminder";
const VOCAB_DUE_REMINDER_HREF = "/app/vocabulary";

interface DueReminderRow {
  userId: string;
  dueCount: number;
}

function authorized(request: Request): boolean {
  // Чистая проверка вынесена в src/lib/cron-auth.ts (тестируется без Request).
  return isCronAuthorized(
    request.headers.get("authorization"),
    cronSecret(),
  );
}

function dueTitle(dueCount: number): string {
  return dueCount === 1
    ? "1 vocabulary card is due today"
    : `${dueCount} vocabulary cards are due today`;
}

async function selectDueReminderRows(): Promise<DueReminderRow[]> {
  // UTC-день строится в SQL через now(): без JS Date-параметров внутри raw sql``.
  const dayStart = sql`(date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')`;

  // Группируем по (user, тир профиля, тир дека), а тир-фильтр применяем В JS точной
  // app-логикой effectiveTier/meetsTier — SQL-дубликат семантики premium_until
  // разъезжался бы с приложением. Иначе юзер с истёкшим premium получал бы
  // напоминания о картах, ревью которых getReviewQueue ему уже не отдаст.
  const rows = await db
    .select({
      userId: vocabProgress.userId,
      profileTier: profile.tier,
      premiumUntil: profile.premiumUntil,
      deckTier: vocabDeck.tierRequired,
      dueCount: sql<number>`count(*)::int`,
    })
    .from(vocabProgress)
    .innerJoin(vocabCard, eq(vocabCard.id, vocabProgress.cardId))
    .innerJoin(
      vocabDeck,
      and(eq(vocabDeck.id, vocabCard.deckId), eq(vocabDeck.status, "published")),
    )
    .innerJoin(profile, eq(profile.id, vocabProgress.userId))
    .leftJoin(
      notification,
      and(
        eq(notification.userId, vocabProgress.userId),
        eq(notification.type, VOCAB_DUE_REMINDER_TYPE),
        sql`${notification.data}->>'kind' = ${VOCAB_DUE_REMINDER_KIND}`,
        sql`${notification.createdAt} >= ${dayStart}`,
        sql`${notification.createdAt} < ${dayStart} + interval '1 day'`,
      ),
    )
    .where(and(lte(vocabProgress.dueAt, sql`now()`), isNull(notification.id)))
    .groupBy(vocabProgress.userId, profile.tier, profile.premiumUntil, vocabDeck.tierRequired);

  const byUser = new Map<string, number>();
  for (const r of rows) {
    const tier = effectiveTier({ tier: r.profileTier, premium_until: r.premiumUntil });
    if (!meetsTier(tier, r.deckTier)) continue;
    byUser.set(r.userId, (byUser.get(r.userId) ?? 0) + Number(r.dueCount));
  }
  return [...byUser.entries()].map(([userId, dueCount]) => ({ userId, dueCount }));
}

async function createDueReminders(): Promise<number> {
  const rows = await selectDueReminderRows();
  const items: NewNotification[] = rows.map((row) => {
    const dueCount = Number(row.dueCount);
    return {
      userId: row.userId,
      type: VOCAB_DUE_REMINDER_TYPE,
      title: dueTitle(dueCount),
      body: "Open your vocabulary queue to review due cards.",
      data: {
        kind: VOCAB_DUE_REMINDER_KIND,
        href: VOCAB_DUE_REMINDER_HREF,
        dueCount,
      },
    };
  });

  await createNotifications(items);
  return items.length;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const created = await createDueReminders();
    return NextResponse.json({ ok: true, created }, { status: 200 });
  } catch (e) {
    await logError({
      source: "server",
      message: `vocab due reminders cron failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      url: request.url,
      context: { route: "/api/cron/vocab-due-reminders" },
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// Vercel Cron вызывает endpoints методом GET — поддерживаем оба.
export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
