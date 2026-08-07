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
import { pickDailyQuestion } from "@/lib/telegram/student/daily-question";
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
// Явный потолок функции: RUN_DEADLINE_MS (240с) обязан помещаться в лимит с запасом
// на финализацию (batch-события, отметки), какой бы ни была платформенная умолчалка.
export const maxDuration = 300;

/** Потолок получателей за прогон: держит крон в пределах лимита времени функции
 *  (Telegram ~30 msg/s, но каждый получатель — ещё и пара запросов в БД). */
const RUN_CAP = 300;

/** Мягкий дедлайн прогона (мс): последовательная рассылка на сотни получателей может
 *  не влезть в лимит функции, а убитая платформой лямбда не оставляет ни ответа, ни
 *  лога. Останавливаемся сами с запасом: необработанный хвост не отмечен last_nudge_on
 *  и уйдёт ЗАВТРА первым (listNudgeTargets сортирует по давности отметки). */
const RUN_DEADLINE_MS = 240_000;

/** Отсечка ПЕРЕД отправкой (остаточный сценарий Codex-ре-ревью): дедлайн выше
 *  проверяется до получателя, но затянувшийся pickDailyQuestion/БД могли бы сдвинуть
 *  старт доставки к самому maxDuration — Telegram сообщение примет, а платформа
 *  оборвёт функцию до markNudged, и завтра человек получит дубль. Отправка не
 *  начинается позже T+265с: доставка ≤25с (fetch-таймаут callBotApi) → ≤290с,
 *  на отметку остаётся ≥10с. Непосланный получатель не отмечен → truncated → завтра
 *  идёт первым. */
const SEND_CUTOFF_MS = 265_000;

function authorized(request: Request): boolean {
  return isCronAuthorized(request.headers.get("authorization"), cronSecret());
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ ok: false }, { status: 401 });

  const cfg = studentBotConfig();
  if (!cfg) return NextResponse.json({ ok: true, skipped: "not_configured" }, { status: 200 });

  const today = utcDateStr(new Date());

  try {
    const startedAt = Date.now();
    const targets = await listNudgeTargets(today, RUN_CAP);
    let questions = 0;
    let streaks = 0;
    let onSite = 0;
    let silent = 0;
    let unlinked = 0;
    let truncated = 0;
    let processed = 0;
    const sentEvents: Array<{ distinctId: string; properties: { channel: "telegram"; kind: NudgeKind } }> = [];

    // true = бюджета «доставка+отметка» не осталось: текущий получатель НЕ отмечен,
    // возвращается в truncated-хвост и завтра идёт первым. Бухгалтерия здесь же,
    // чтобы у трёх send-веток не разъезжались три копии.
    const stopBeforeSend = (): boolean => {
      if (Date.now() - startedAt <= SEND_CUTOFF_MS) return false;
      processed -= 1;
      truncated = targets.length - processed;
      return true;
    };

    for (const t of targets) {
      // Дедлайн проверяем ДО получателя: полуобработанный (вопрос ушёл, отметки нет)
      // хуже пропущенного — пропущенного честно догонит завтрашний прогон.
      if (Date.now() - startedAt > RUN_DEADLINE_MS) {
        truncated = targets.length - processed;
        break;
      }
      processed += 1;
      try {
        const pick = await pickDailyQuestion(t.userId);
        let result: Awaited<ReturnType<typeof sendStudentMessage>> = "ok";
        let kind: NudgeKind | null = null;

        if (pick.question) {
          if (stopBeforeSend()) break;
          result = await deliverQuestion(cfg.token, t.chatId, t.userId, pick.question);
          kind = "daily_question";
        } else if (pick.dueTotal > 0) {
          // Повторять есть что, но эти задания без пассажа не решаются — зовём на
          // сайт, а не присылаем задачу без условия.
          if (stopBeforeSend()) break;
          result = await sendStudentMessage(
            cfg.token,
            t.chatId,
            mistakesOnSiteMessage(pick.dueTotal, mistakesUrl()),
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
            if (stopBeforeSend()) break;
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

    // Обрыв по дедлайну — не тихая правка охвата: фиксируем в error_log, чтобы рост
    // хвоста было видно ДО того, как рассылка перестанет доезжать до половины людей.
    if (truncated > 0) {
      await logError({
        source: "server",
        message: `telegram nudge run hit its deadline: ${truncated} of ${targets.length} recipients postponed to tomorrow`,
        context: { route: "/api/cron/telegram-nudge", truncated, targets: targets.length },
      });
    }

    return NextResponse.json(
      { ok: true, targets: targets.length, questions, streaks, onSite, silent, unlinked, truncated },
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
