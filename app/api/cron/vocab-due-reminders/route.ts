import { NextResponse } from "next/server";
import { and, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { notification, profile, vocabCard, vocabDeck, vocabProgress } from "@/db/schema";
import { effectiveTier, meetsTier } from "@/lib/tiers";
import { cronSecret } from "@/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logError } from "@/lib/monitoring/log-error";
import { createNotifications, type NewNotification } from "@/lib/notifications/create";
import {
  utcDateStr,
  prevUtcDateStr,
  vocabDueDedupKey,
  streakDedupKey,
} from "@/lib/notifications/schedule";

export const dynamic = "force-dynamic";

// Единый ежедневный cron уведомлений (Vercel Hobby — один cron на роут; §11 daily
// напоминания живут здесь, не плодим отдельные роуты): vocab-due + streak + ретеншен.
const VOCAB_DUE_REMINDER_TYPE = "system" as const;
const VOCAB_DUE_REMINDER_KIND = "vocab_due_reminder";
const VOCAB_DUE_REMINDER_HREF = "/app/vocabulary";
const STREAK_REMINDER_TYPE = "streak_reminder" as const;
const STREAK_REMINDER_HREF = "/app/practice";

// Прочитанные уведомления — журнал шапки, не аудит: квартала с лихвой хватает
// увидеть «что я пропустил», а старше — только раздувают таблицу. Чистим батчами,
// чтобы разовый прогон не держал длинную транзакцию.
const RETENTION_DAYS = 90;
const RETENTION_BATCH = 500;

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
  // Группируем по (user, тир профиля, тир дека), а тир-фильтр применяем В JS точной
  // app-логикой effectiveTier/meetsTier — SQL-дубликат семантики premium_until
  // разъезжался бы с приложением. Иначе юзер с истёкшим premium получал бы
  // напоминания о картах, ревью которых getReviewQueue ему уже не отдаст. Дедуп
  // «одно на день» теперь атомарен на INSERT (dedup_key), поэтому leftJoin убран.
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
    .where(lte(vocabProgress.dueAt, sql`now()`))
    .groupBy(vocabProgress.userId, profile.tier, profile.premiumUntil, vocabDeck.tierRequired);

  const byUser = new Map<string, number>();
  for (const r of rows) {
    const tier = effectiveTier({ tier: r.profileTier, premium_until: r.premiumUntil });
    if (!meetsTier(tier, r.deckTier)) continue;
    byUser.set(r.userId, (byUser.get(r.userId) ?? 0) + Number(r.dueCount));
  }
  return [...byUser.entries()].map(([userId, dueCount]) => ({ userId, dueCount }));
}

async function createDueReminders(today: string): Promise<number> {
  const rows = await selectDueReminderRows();
  const dedupKey = vocabDueDedupKey(today);
  const items: NewNotification[] = rows.map((row) => {
    const dueCount = Number(row.dueCount);
    return {
      userId: row.userId,
      type: VOCAB_DUE_REMINDER_TYPE,
      kind: VOCAB_DUE_REMINDER_KIND,
      title: dueTitle(dueCount),
      body: "Open your vocabulary queue to review due cards.",
      data: {
        // data.kind остаётся для view.ts (parseNotifPayload читает href/dueCount).
        kind: VOCAB_DUE_REMINDER_KIND,
        href: VOCAB_DUE_REMINDER_HREF,
        dueCount,
      },
      // Атомарный дедуп «одно напоминание на (user, UTC-день)».
      dedupKey,
    };
  });

  // Возвращаем РЕАЛЬНО вставленное (returning), не число кандидатов: повторный
  // прогон в тот же день молча схлопывается дедупом и должен отчитаться нулём.
  return createNotifications(items);
}

/**
 * Streak-продюсер (BRIEF §11, type='streak_reminder'). Кандидаты — юзеры с активным
 * стриком (current_streak > 0), чья последняя активность была ВЧЕРА (UTC): у них
 * стрик под угрозой, есть ещё сегодня, чтобы его удержать. Семантика «вчера» = та же
 * UTC-дата, что в apply-post-submit (last_activity_date хранится как UTC-день). Кто
 * уже занимался сегодня — last_activity_date = today, отсекается фильтром. tier не
 * гейтим: practice бесплатен. Дедуп «одно на день» — dedup_key.
 */
async function createStreakReminders(today: string): Promise<number> {
  const yesterday = prevUtcDateStr(today);
  const rows = await db
    .select({ userId: profile.id })
    .from(profile)
    .where(and(gt(profile.currentStreak, 0), eq(profile.lastActivityDate, yesterday)));

  const dedupKey = streakDedupKey(today);
  const items: NewNotification[] = rows.map((r) => ({
    userId: r.userId,
    type: STREAK_REMINDER_TYPE,
    title: "Your streak is at risk",
    body: "Practice today to keep your streak alive.",
    data: { href: STREAK_REMINDER_HREF },
    dedupKey,
  }));

  // Как в createDueReminders — факт вставки, не число кандидатов.
  return createNotifications(items);
}

/**
 * Ретеншен: удаляем прочитанные уведомления старше RETENTION_DAYS. Owner-путь
 * (Drizzle, минует RLS). Батчами по id — postgres DELETE не поддерживает LIMIT, а
 * select+inArray избегает raw-DELETE и не держит длинную блокировку на большой
 * таблице. make_interval с числом (не Date-параметр в raw sql — иначе pgbouncer-крэш).
 */
async function purgeOldRead(): Promise<number> {
  const olderThanCutoff = sql`${notification.createdAt} < now() - make_interval(days => ${RETENTION_DAYS})`;
  let removed = 0;
  for (;;) {
    const rows = await db
      .select({ id: notification.id })
      .from(notification)
      .where(and(isNotNull(notification.readAt), olderThanCutoff))
      .limit(RETENTION_BATCH);
    if (rows.length === 0) break;
    await db.delete(notification).where(inArray(notification.id, rows.map((r) => r.id)));
    removed += rows.length;
    if (rows.length < RETENTION_BATCH) break;
  }
  return removed;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const today = utcDateStr(new Date());

  try {
    // Vocab-блок — основной: его падение = 500 (поведение как раньше).
    const created = await createDueReminders(today);

    // Streak и ретеншен — best-effort: их сбой логируем, но он не роняет ни ответ,
    // ни соседний блок (§11 напоминание некритично).
    let streak = 0;
    try {
      streak = await createStreakReminders(today);
    } catch (e) {
      await logError({
        source: "server",
        message: `streak reminders cron failed: ${e instanceof Error ? e.message : String(e)}`,
        stack: e instanceof Error ? e.stack : null,
        url: request.url,
        context: { route: "/api/cron/vocab-due-reminders", block: "streak" },
      });
    }

    let purged = 0;
    try {
      purged = await purgeOldRead();
    } catch (e) {
      await logError({
        source: "server",
        message: `notification retention cron failed: ${e instanceof Error ? e.message : String(e)}`,
        stack: e instanceof Error ? e.stack : null,
        url: request.url,
        context: { route: "/api/cron/vocab-due-reminders", block: "retention" },
      });
    }

    return NextResponse.json({ ok: true, created, streak, purged }, { status: 200 });
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
