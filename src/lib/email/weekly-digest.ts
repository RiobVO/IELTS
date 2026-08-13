import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { attempt, authUsers, notification, profile } from "@/db/schema";
import { cronSecret, emailDigestConfig, publicSiteUrl } from "@/env";
import { buildDigestEmail, type DigestStats } from "@/lib/email/digest-template";
import { isoWeekKey } from "@/lib/email/iso-week";
import { sendEmail } from "@/lib/email/send";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";

// Чистый ключ недели живёт в отдельном модуле (без server-only/@/db) ради unit-теста;
// реэкспорт держит его доступным и с публичной поверхности оркестратора.
export { isoWeekKey };

/**
 * Ядро weekly email digest (BRIEF §11/§12.1). Оркестрирует один прогон рассылки:
 * находит юзеров с активностью за неделю, пишет ledger-уведомление (идемпотентность)
 * и шлёт письмо. Env-gated: без EMAIL_PROVIDER_API_KEY/EMAIL_FROM — полный no-op
 * (прод без ключей не трогаем). Зовётся из cron-ручки и piggyback'ом из snapshot-ranks.
 */

const WINDOW_DAYS = 7; // trailing-окно активности
// Ledger-страховка: не шлём повторно, если weekly_digest-уведомление моложе 6 дней.
// 6 (а не 7) даёт суточный люфт — чуть ранний ре-ран не дублирует письмо, но
// следующая настоящая неделя (7д) не блокируется.
const LEDGER_GUARD_DAYS = 6;
// Cap на прогон: free-tier Brevo = 300 писем/сутки. Остаток НЕ обрабатывается и
// логируется; ledger пишется только обработанным, поэтому ручной ре-ран доберёт хвост.
const RUN_CAP = 250;
const DIGEST_TYPE = "weekly_digest" as const;
const DAY_MS = 86_400_000;

export interface WeeklyDigestResult {
  skipped?: "not_configured";
  candidates: number;
  notified: number;
  sent: number;
  optedOut: number;
  capped: number;
}

/** per-type разбивка на момент сдачи (attempt.per_type_breakdown): {qtype: {correct,total}}. */
type PerTypeBreakdown = Record<string, { correct?: number; total?: number }> | null;

interface AttemptStatRow {
  bandScore: string | null;
  rawScore: number | null;
  perTypeBreakdown: PerTypeBreakdown;
}

interface WindowStats {
  testsCount: number;
  avgBand: number | null;
  avgPercent: number | null;
}

/** Сумма total по всем типам вопросов = число вопросов в тесте (снимок на сдаче). */
function perTypeTotal(breakdown: PerTypeBreakdown): number {
  if (!breakdown || typeof breakdown !== "object") return 0;
  let total = 0;
  for (const v of Object.values(breakdown)) {
    const t = v?.total;
    if (typeof t === "number" && Number.isFinite(t)) total += t;
  }
  return total;
}

/**
 * Агрегирует статистику окна по attempts одного юзера. avgBand — только по attempts
 * с band (Full-40Q), null если таких нет. avgPercent — среднее по attempts, где
 * известно число вопросов (per_type_breakdown), null если считать не из чего.
 */
function aggregateWindow(rows: AttemptStatRow[]): WindowStats {
  let bandSum = 0;
  let bandCount = 0;
  let pctSum = 0;
  let pctCount = 0;
  for (const r of rows) {
    if (r.bandScore != null) {
      const band = Number(r.bandScore);
      if (Number.isFinite(band)) {
        bandSum += band;
        bandCount += 1;
      }
    }
    const total = perTypeTotal(r.perTypeBreakdown);
    if (total > 0 && r.rawScore != null) {
      pctSum += (r.rawScore / total) * 100;
      pctCount += 1;
    }
  }
  return {
    testsCount: rows.length,
    avgBand: bandCount > 0 ? bandSum / bandCount : null,
    avgPercent: pctCount > 0 ? pctSum / pctCount : null,
  };
}

interface Candidate {
  userId: string;
  email: string | null;
  rating: number;
  optOut: boolean;
}

export async function runWeeklyDigest(
  now: Date = new Date(),
): Promise<WeeklyDigestResult> {
  const cfg = emailDigestConfig();
  if (cfg === null) {
    // Фича выключена — ничего не пишем и не шлём (прод без ключей неизменен).
    return { skipped: "not_configured", candidates: 0, notified: 0, sent: 0, optedOut: 0, capped: 0 };
  }

  const nowMs = now.getTime();
  // Границы окна — строками ISO (НЕ Date-объекты в raw sql``: pgbouncer+prepare:false
  // роняет прод на Date). ::timestamptz-каст делает сравнение с колонкой явным.
  const windowStartIso = new Date(nowMs - WINDOW_DAYS * DAY_MS).toISOString();
  const windowEndIso = now.toISOString();
  const ledgerSinceIso = new Date(nowMs - LEDGER_GUARD_DAYS * DAY_MS).toISOString();

  // Кандидаты: ≥1 submitted-attempt в окне, подтверждённый email (защита репутации
  // домена от bounce), без weekly_digest-уведомления моложе 6 дней (leftJoin+isNull —
  // ledger идемпотентности, паттерн vocab-due-reminders). selectDistinct схлопывает
  // несколько attempts одного юзера в одну строку-кандидата.
  const candidates: Candidate[] = await db
    .selectDistinct({
      userId: profile.id,
      email: authUsers.email,
      rating: profile.rating,
      optOut: profile.weeklyDigestOptOut,
    })
    .from(attempt)
    .innerJoin(profile, eq(profile.id, attempt.userId))
    .innerJoin(authUsers, eq(authUsers.id, profile.id))
    .leftJoin(
      notification,
      and(
        eq(notification.userId, profile.id),
        eq(notification.type, DIGEST_TYPE),
        sql`${notification.createdAt} >= ${ledgerSinceIso}::timestamptz`,
      ),
    )
    .where(
      and(
        eq(attempt.status, "submitted"),
        sql`${attempt.submittedAt} >= ${windowStartIso}::timestamptz`,
        sql`${attempt.submittedAt} < ${windowEndIso}::timestamptz`,
        sql`${authUsers.emailConfirmedAt} is not null`,
        isNull(notification.id),
      ),
    )
    .orderBy(profile.id);

  const total = candidates.length;
  // Детерминированный порядок уже задан orderBy(profile.id); cap отсекает хвост.
  const processed = candidates.slice(0, RUN_CAP);
  const capped = total - processed.length;
  if (capped > 0) {
    console.error("runWeeklyDigest: run cap reached, remainder deferred", {
      candidates: total,
      cap: RUN_CAP,
      capped,
    });
  }
  if (processed.length === 0) {
    return { candidates: total, notified: 0, sent: 0, optedOut: 0, capped };
  }

  const ids = processed.map((c) => c.userId);

  // Attempts окна для обрабатываемых юзеров → статистика (avgPercent требует jsonb
  // per_type_breakdown, поэтому считаем в JS, как vocab-cron).
  const statRows = await db
    .select({
      userId: attempt.userId,
      bandScore: attempt.bandScore,
      rawScore: attempt.rawScore,
      perTypeBreakdown: attempt.perTypeBreakdown,
    })
    .from(attempt)
    .where(
      and(
        inArray(attempt.userId, ids),
        eq(attempt.status, "submitted"),
        sql`${attempt.submittedAt} >= ${windowStartIso}::timestamptz`,
        sql`${attempt.submittedAt} < ${windowEndIso}::timestamptz`,
      ),
    );

  const attemptsByUser = new Map<string, AttemptStatRow[]>();
  for (const r of statRows) {
    const arr = attemptsByUser.get(r.userId) ?? [];
    arr.push({
      bandScore: r.bandScore,
      rawScore: r.rawScore,
      perTypeBreakdown: r.perTypeBreakdown as PerTypeBreakdown,
    });
    attemptsByUser.set(r.userId, arr);
  }

  // Prior rating для Δ: rating из ПОСЛЕДНЕЙ (≥6д, т.к. свежие исключены выше)
  // weekly_digest-notification юзера. desc → первая встреченная = самая свежая.
  const priorRows = await db
    .select({
      userId: notification.userId,
      data: notification.data,
      createdAt: notification.createdAt,
    })
    .from(notification)
    .where(and(inArray(notification.userId, ids), eq(notification.type, DIGEST_TYPE)))
    .orderBy(desc(notification.createdAt));

  const priorRating = new Map<string, number>();
  for (const r of priorRows) {
    if (priorRating.has(r.userId)) continue;
    const raw = (r.data as Record<string, unknown> | null)?.rating;
    const value = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(value)) priorRating.set(r.userId, value);
  }

  const weekStart = windowStartIso.slice(0, 10);
  const weekEnd = windowEndIso.slice(0, 10);
  const weekKey = isoWeekKey(now); // ключ атомарного claim: одно письмо на (user, ISO-week)
  const site = publicSiteUrl();
  const secret = cronSecret();

  let notified = 0;
  let sent = 0;
  let optedOut = 0;

  for (const c of processed) {
    // Один сбой не валит батч — каждый юзер в своём try/catch.
    try {
      const stats = aggregateWindow(attemptsByUser.get(c.userId) ?? []);
      const prior = priorRating.get(c.userId);
      const ratingDelta = prior !== undefined ? c.rating - prior : null;

      // Атомарный claim ДО отправки: INSERT ... ON CONFLICT DO NOTHING по partial
      // unique (user_id, data->>'week') (миграция 0043). Закрывает TOCTOU — параллельный
      // cron + ручной прогон не отправят письмо дважды: побеждает ровно одна вставка.
      // Форма values зеркалит notifications/create.ts (in-app-уведомление идентично);
      // rating обязателен в data — источник Δ следующей недели.
      const [claimed] = await db
        .insert(notification)
        .values({
          userId: c.userId,
          type: DIGEST_TYPE,
          title: "Your weekly IELTS digest",
          body: null,
          data: {
            week: weekKey,
            rating: c.rating,
            testsCount: stats.testsCount,
            avgBand: stats.avgBand,
            avgPercent: stats.avgPercent,
          },
        })
        .onConflictDoNothing()
        .returning({ id: notification.id });

      // Пустой returning → юзера уже заклеймил параллельный прогон → не письмо, не счётчик.
      // Ошибка вставки (не конфликт) уйдёт в catch ниже → тоже без отправки (fail-closed:
      // нет ledger — нет письма).
      if (!claimed) continue;
      notified += 1;

      if (c.optOut) {
        optedOut += 1;
        continue;
      }
      if (!c.email) continue;

      // site/secret отсутствуют → unsubscribeUrl null, письмо всё равно шлём.
      const unsubscribeUrl =
        site && secret
          ? `${site}/api/email/unsubscribe?u=${c.userId}&t=${signUnsubscribeToken(c.userId, secret)}`
          : null;

      const digestStats: DigestStats = {
        testsCount: stats.testsCount,
        avgBand: stats.avgBand,
        avgPercent: stats.avgPercent,
        rating: c.rating,
        ratingDelta,
        weekStart,
        weekEnd,
        unsubscribeUrl,
      };
      const { subject, html } = buildDigestEmail(digestStats);
      const ok = await sendEmail(cfg, { to: c.email, subject, html, unsubscribeUrl });
      if (ok) sent += 1;
    } catch (e) {
      // Без PII: userId ок, email не логируем (гигиена, как в send.ts).
      console.error("runWeeklyDigest: per-user failure", {
        userId: c.userId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { candidates: total, notified, sent, optedOut, capped };
}
