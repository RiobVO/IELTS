import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { cronSecret, studentBotConfig } from "@/env";
import { captureServerBatch } from "@/lib/analytics/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logError } from "@/lib/monitoring/log-error";
import { isStreakAtRisk, utcDateStr } from "@/lib/notifications/schedule";
import { sendStudentMessage } from "@/lib/telegram/student/client";
import { countDueMistakes, pickDailyQuestion } from "@/lib/telegram/student/daily-question";
import { deliverQuestion, mistakesUrl, practiceUrl } from "@/lib/telegram/student/deliver";
import { mistakesOnSiteMessage, streakMessage } from "@/lib/telegram/student/messages";
import { listNudgeTargets, markNudged, unlinkByChat } from "@/lib/telegram/student/store";
import type { NudgeKind } from "@/lib/analytics/events";

/**
 * Ежедневная рассылка студенческого бота (G2-1). Отдельный роут, а не блок в
 * общем кроне уведомлений: у него внешняя зависимость (Telegram API) и своё время
 * — вечер, а не ночь, когда крутится остальная периодика.
 *
 * ОДНО сообщение в день и только по делу, по убыванию ценности:
 *   1) вопрос из СВОИХ ошибок (см. daily-question.ts — почему не случайный из каталога);
 *   2) если повторять нечего, но стрик под угрозой — короткий пинг;
 *   3) иначе МОЛЧИМ. Напоминание без повода — прямая дорога к /stop.
 *
 * Идемпотентность: last_nudge_on (UTC-день) проверяется в выборке и ставится после
 * отправки, поэтому повторный прогон в тот же день никому не пишет второй раз.
 */
export const dynamic = "force-dynamic";

/** Потолок получателей за прогон: держит крон в пределах лимита времени функции
 *  (Telegram ~30 msg/s, но каждый получатель — ещё и пара запросов в БД). */
const RUN_CAP = 300;

function authorized(request: Request): boolean {
  return isCronAuthorized(request.headers.get("authorization"), cronSecret());
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ ok: false }, { status: 401 });

  const cfg = studentBotConfig();
  if (!cfg) return NextResponse.json({ ok: true, skipped: "not_configured" }, { status: 200 });

  const today = utcDateStr(new Date());

  try {
    const targets = await listNudgeTargets(today, RUN_CAP);
    let questions = 0;
    let streaks = 0;
    let onSite = 0;
    let silent = 0;
    let unlinked = 0;
    const sentEvents: Array<{ distinctId: string; properties: { channel: "telegram"; kind: NudgeKind } }> = [];

    for (const t of targets) {
      try {
        const q = await pickDailyQuestion(t.userId);
        let result: Awaited<ReturnType<typeof sendStudentMessage>> = "ok";
        let kind: NudgeKind | null = null;

        const dueTotal = q ? 0 : await countDueMistakes(t.userId);

        if (q) {
          result = await deliverQuestion(cfg.token, t.chatId, t.userId, q);
          kind = "daily_question";
        } else if (dueTotal > 0) {
          // Есть что повторять, но задания требуют текста пассажа — зовём на сайт,
          // а не присылаем задачу без условия.
          result = await sendStudentMessage(
            cfg.token,
            t.chatId,
            mistakesOnSiteMessage(dueTotal, mistakesUrl()),
          );
          kind = "mistakes_on_site";
        } else {
          // Повторять нечего — пингуем только тех, у кого сегодня рвётся стрик.
          const [p] = await db
            .select({ streak: profile.currentStreak, lastActivity: profile.lastActivityDate })
            .from(profile)
            .where(eq(profile.id, t.userId))
            .limit(1);
          const streak = p?.streak ?? 0;
          const lastDay = p?.lastActivity != null ? String(p.lastActivity) : null;
          if (isStreakAtRisk(streak, lastDay, today)) {
            result = await sendStudentMessage(cfg.token, t.chatId, streakMessage(streak, practiceUrl()));
            kind = "streak";
          } else {
            silent += 1;
            // День всё равно отмечаем: иначе следующий прогон снова переберёт этого
            // человека впустую.
            await markNudged(t.userId, today);
            continue;
          }
        }

        if (result === "blocked") {
          // Человек заблокировал бота — перестаём быть его получателем. Молча и сразу:
          // это и есть отписка, выраженная действием.
          await unlinkByChat(t.chatId);
          unlinked += 1;
          continue;
        }

        await markNudged(t.userId, today);
        if (result === "ok" && kind) {
          if (kind === "daily_question") questions += 1;
          else if (kind === "mistakes_on_site") onSite += 1;
          else streaks += 1;
          sentEvents.push({ distinctId: t.userId, properties: { channel: "telegram", kind } });
        }
      } catch (e) {
        // Сбой одного получателя не должен обрывать рассылку остальным.
        await logError({
          source: "server",
          message: `telegram nudge failed for one recipient: ${e instanceof Error ? e.message : String(e)}`,
          stack: e instanceof Error ? e.stack : null,
          context: { route: "/api/cron/telegram-nudge", userId: t.userId },
        });
      }
    }

    await captureServerBatch("nudge_sent", sentEvents);

    return NextResponse.json(
      { ok: true, targets: targets.length, questions, streaks, onSite, silent, unlinked },
      { status: 200 },
    );
  } catch (e) {
    await logError({
      source: "server",
      message: `telegram nudge cron failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      url: request.url,
      context: { route: "/api/cron/telegram-nudge" },
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// Vercel Cron ходит методом GET — поддерживаем оба.
export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
