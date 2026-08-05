import "server-only";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { authUsers, contentItem, profile } from "@/db/schema";
import { emailDigestConfig, publicSiteUrl } from "@/env";
import { buildReactivationEmail } from "@/lib/email/reactivation-template";
import { sendEmail } from "@/lib/email/send";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { captureServerBatch } from "@/lib/analytics/server";
import { createNotifications, type NewNotification } from "@/lib/notifications/create";
import {
  REACTIVATION_THRESHOLD_DAYS,
  reactivationDedupKey,
  shiftUtcDateStr,
  utcDateStr,
} from "@/lib/notifications/schedule";

/**
 * Реактивация уснувших (G2-4). Дайджест по построению обслуживает тех, кто И ТАК
 * занимается (его кандидаты — юзеры с активностью за 7 дней), поэтому человек,
 * пропавший ровно после первой недели, не получал ни одного касания — при том что
 * именно он и есть цель волны удержания.
 *
 * Отбор: последняя активность была РОВНО N дней назад (7 и 14). Точное равенство,
 * а не «>= N», даёт однократность внутри эпизода тишины без отдельного стейта:
 * такой день наступает один раз, а вернувшийся человек просто перестаёт подходить
 * под условие.
 *
 * Каналы: in-app уведомление (всем, дёшево и не спамит) + письмо (только тем, кто
 * не отписан от рассылки и подтвердил адрес). Письмо необязательно: без почтовых
 * ключей блок всё равно создаёт уведомления.
 */

/** Дней тишины → кому пишем. Общий словарь с расписанием, чтобы пороги не разошлись. */
const THRESHOLDS = REACTIVATION_THRESHOLD_DAYS;

/** Окно «что нового» в письме — та же неделя, что у витрины новинок (G1-2). */
const NEW_TESTS_WINDOW_DAYS = 7;

/**
 * Потолок писем на прогон. Brevo free — 300/сутки, и недельный дайджест уже
 * занимает до 250 в свой день; реактивация ежедневная, поэтому берёт заведомо
 * меньшую долю. Хвост НЕ теряется молча: он логируется и уедет следующим прогоном
 * (кандидаты сдвинутся, но уведомление в приложении такие люди уже получили).
 */
const EMAIL_RUN_CAP = 100;

const REACTIVATION_KIND = "reactivation";
const REACTIVATION_HREF = "/app/practice";

export interface ReactivationResult {
  candidates: number;
  /** Создано in-app уведомлений (после дедупа). */
  notified: number;
  /** Доставлено писем. */
  sent: number;
  /** Кандидатов, отписанных от рассылки (письма не будет, уведомление есть). */
  optedOut: number;
  /** Писем, не отправленных из-за потолка прогона. */
  capped: number;
  /** true — почтовые ключи не сконфигурированы, слали только уведомления. */
  emailSkipped: boolean;
}

interface Candidate {
  userId: string;
  lastActivityDay: string;
  streak: number;
  optOut: boolean;
  email: string | null;
  emailConfirmedAt: Date | null;
}

/** Сколько тестов опубликовано за последнюю неделю — крючок письма («вот что
 *  появилось, пока тебя не было»). Один запрос на прогон, не на получателя. */
async function countNewTests(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contentItem)
    .where(
      and(
        eq(contentItem.status, "published"),
        isNotNull(contentItem.publishedAt),
        gte(contentItem.publishedAt, sql`now() - make_interval(days => ${NEW_TESTS_WINDOW_DAYS})`),
      ),
    );
  return row?.n ?? 0;
}

function notificationFor(c: Candidate, thresholdDays: number, today: string): NewNotification {
  const title =
    thresholdDays >= 14 ? "Your practice has been on pause" : "Pick your practice back up";
  const body =
    c.streak > 0
      ? `You were on a ${c.streak}-day streak — one test starts a new one.`
      : "One test is enough to get moving again.";
  return {
    userId: c.userId,
    type: "system",
    kind: REACTIVATION_KIND,
    title,
    body,
    data: { kind: REACTIVATION_KIND, href: REACTIVATION_HREF, days_silent: thresholdDays },
    dedupKey: reactivationDedupKey(thresholdDays, today),
  };
}

export async function runReactivation(now: Date = new Date()): Promise<ReactivationResult> {
  const today = utcDateStr(now);
  // Целевые дни: «последняя активность ровно N дней назад» для каждого порога.
  const dayToThreshold = new Map<string, number>();
  for (const t of THRESHOLDS) dayToThreshold.set(shiftUtcDateStr(today, t), t);
  const targetDays = [...dayToThreshold.keys()];

  const rows = await db
    .select({
      userId: profile.id,
      lastActivityDay: profile.lastActivityDate,
      streak: profile.currentStreak,
      optOut: profile.weeklyDigestOptOut,
      email: authUsers.email,
      emailConfirmedAt: authUsers.emailConfirmedAt,
    })
    .from(profile)
    .innerJoin(authUsers, eq(authUsers.id, profile.id))
    .where(inArray(profile.lastActivityDate, targetDays));

  const candidates: Candidate[] = rows.map((r) => ({
    userId: r.userId,
    lastActivityDay: String(r.lastActivityDay),
    streak: r.streak,
    optOut: r.optOut,
    email: r.email,
    emailConfirmedAt: r.emailConfirmedAt,
  }));

  if (candidates.length === 0) {
    return { candidates: 0, notified: 0, sent: 0, optedOut: 0, capped: 0, emailSkipped: false };
  }

  // 1) In-app — пачкой, с атомарным дедупом по (user, порог, день). Список реально
  // созданных решает, кому уходит письмо: иначе повторный прогон крона в тот же день
  // прислал бы второе письмо на уже погашенное уведомление.
  const items = candidates.map((c) =>
    notificationFor(c, dayToThreshold.get(c.lastActivityDay) ?? THRESHOLDS[0], today),
  );
  const notifiedUserIds = await createNotifications(items);
  const notifiedSet = new Set(notifiedUserIds);

  await captureServerBatch(
    "nudge_sent",
    notifiedUserIds.map((userId) => ({
      distinctId: userId,
      properties: { channel: "in_app" as const, kind: "reactivation" as const },
    })),
  );

  // 2) Письма — только новым уведомлениям, с подтверждённым адресом и без opt-out.
  const cfg = emailDigestConfig();
  if (cfg === null) {
    return {
      candidates: candidates.length,
      notified: notifiedUserIds.length,
      sent: 0,
      optedOut: candidates.filter((c) => c.optOut).length,
      capped: 0,
      emailSkipped: true,
    };
  }

  const site = publicSiteUrl();
  const newTests = await countNewTests();
  let sent = 0;
  let optedOut = 0;
  let capped = 0;
  const delivered: string[] = [];

  for (const c of candidates) {
    if (!notifiedSet.has(c.userId)) continue;
    if (c.optOut) {
      optedOut += 1;
      continue;
    }
    // Неподтверждённый адрес не трогаем — bounce бьёт по репутации домена (та же
    // защита, что в дайджесте).
    if (!c.email || c.emailConfirmedAt == null) continue;
    if (sent >= EMAIL_RUN_CAP) {
      capped += 1;
      continue;
    }

    const thresholdDays = dayToThreshold.get(c.lastActivityDay) ?? THRESHOLDS[0];
    const unsubscribeUrl = site
      ? `${site}/api/email/unsubscribe?u=${c.userId}&t=${signUnsubscribeToken(c.userId, cfg.apiKey)}`
      : null;
    const { subject, html } = buildReactivationEmail({
      daysSilent: thresholdDays,
      newTestsThisWeek: newTests,
      lastStreak: c.streak,
      // ?src= — существующий механизм атрибуции канала (middleware кладёт его в cookie).
      practiceUrl: site ? `${site}${REACTIVATION_HREF}?src=reactivation` : null,
      unsubscribeUrl,
    });

    try {
      const ok = await sendEmail(cfg, { to: c.email, subject, html, unsubscribeUrl });
      if (ok) {
        sent += 1;
        delivered.push(c.userId);
      }
    } catch (e) {
      // Без PII: userId ок, адрес не логируем (гигиена send.ts). Сбой одного письма
      // не должен обрывать рассылку остальным.
      console.error("runReactivation: per-user failure", {
        userId: c.userId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (capped > 0) {
    console.warn(`runReactivation: email cap reached, ${capped} recipient(s) not emailed today`);
  }

  await captureServerBatch(
    "nudge_sent",
    delivered.map((userId) => ({
      distinctId: userId,
      properties: { channel: "email" as const, kind: "reactivation" as const },
    })),
  );

  return {
    candidates: candidates.length,
    notified: notifiedUserIds.length,
    sent,
    optedOut,
    capped,
    emailSkipped: false,
  };
}
