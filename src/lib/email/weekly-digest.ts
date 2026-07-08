import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { attempt, authUsers, notification, profile } from "@/db/schema";
import { cronSecret, emailDigestConfig, publicSiteUrl } from "@/env";
import { buildDigestEmail, type DigestStats } from "@/lib/email/digest-template";
import { digestNeedsRetry, parseDigestClaimStats } from "@/lib/email/digest-retry";
import { isoWeekKey } from "@/lib/email/iso-week";
import { sendEmail } from "@/lib/email/send";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { getBandPlan } from "@/lib/progress/band-plan";

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
  /** Писем доставлено ретраем — pending-строки (sent:false) прошлых прогонов. */
  retried: number;
}

/** Конфиг рассылки после null-гейта (apiKey/from/fromName) — тип для хелперов. */
type DigestConfig = NonNullable<ReturnType<typeof emailDigestConfig>>;

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

/** Числа + контекст, из которых собирается и шлётся одно письмо (общий путь для
 *  свежей рассылки и ретрая). */
interface DeliverInput {
  userId: string;
  email: string;
  rating: number;
  ratingDelta: number | null;
  testsCount: number;
  avgBand: number | null;
  avgPercent: number | null;
}

interface DeliverCtx {
  now: Date;
  site: string | null;
  secret: string | null;
  weekStart: string;
  weekEnd: string;
}

/**
 * Собирает и отправляет одно письмо дайджеста. Возвращает результат sendEmail
 * (true = доставлено). НЕ трогает ledger — маркировкой `sent` управляет вызывающий
 * (mark-after-send). bandPlan — украшение: его сбой не отменяет письмо (шлём без
 * секции). Общий для основного цикла и ретрая, чтобы билд письма не дублировался.
 */
async function deliverDigest(cfg: DigestConfig, ctx: DeliverCtx, input: DeliverInput): Promise<boolean> {
  let plan: DigestStats["bandPlan"];
  try {
    plan = await getBandPlan(input.userId, ctx.now);
  } catch (e) {
    // Без PII, как per-user catch в оркестраторе.
    console.error("runWeeklyDigest: band-plan failure, sending without plan", {
      userId: input.userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  const unsubscribeUrl =
    ctx.site && ctx.secret
      ? `${ctx.site}/api/email/unsubscribe?u=${input.userId}&t=${signUnsubscribeToken(input.userId, ctx.secret)}`
      : null;
  const practiceUrl = ctx.site ? `${ctx.site}/app/practice` : null;
  const digestStats: DigestStats = {
    testsCount: input.testsCount,
    avgBand: input.avgBand,
    avgPercent: input.avgPercent,
    rating: input.rating,
    ratingDelta: input.ratingDelta,
    weekStart: ctx.weekStart,
    weekEnd: ctx.weekEnd,
    unsubscribeUrl,
    bandPlan: plan,
    practiceUrl,
  };
  const { subject, html } = buildDigestEmail(digestStats);
  return sendEmail(cfg, { to: input.email, subject, html, unsubscribeUrl });
}

/**
 * Атомарно «занимает» claim-строку под отправку: флипает `sent` false→true и
 * возвращает true ТОЛЬКО победителю (RETURNING непустой). Из двух параллельных
 * прогонов, увидевших одну pending-строку, отправит письмо ровно один — закрывает
 * double-send и на fresh-, и на retry-пути. Условие `= 'false'` не трогает
 * legacy-строки без ключа. jsonb-конкатенация без Date-параметров (pgbouncer
 * prepare:false роняет прод на Date в raw sql``).
 *
 * Терминальные ветки (opt-out / нет-адреса / unconfirmed) зовут это же и игнорируют
 * результат — просто снимают строку с ретрая.
 */
async function claimDigestSend(id: string): Promise<boolean> {
  const [won] = await db
    .update(notification)
    .set({ data: sql`${notification.data} || '{"sent":true}'::jsonb` })
    .where(and(eq(notification.id, id), sql`${notification.data}->>'sent' = 'false'`))
    .returning({ id: notification.id });
  return won != null;
}

/** Откат захвата после неудачной доставки: sent true→false, чтобы строку добрал
 *  ретрай следующего прогона. Best-effort. */
async function releaseDigestSend(id: string): Promise<void> {
  await db
    .update(notification)
    .set({ data: sql`${notification.data} || '{"sent":false}'::jsonb` })
    .where(and(eq(notification.id, id), sql`${notification.data}->>'sent' = 'true'`));
}

/**
 * Единый безопасный путь доставки для fresh- и retry-веток: атомарно занимает
 * строку (claimDigestSend), шлёт письмо только если захват удался, и при неудаче
 * (sendEmail=false или брошенное исключение) откатывает `sent` в pending для
 * будущего ретрая. Возвращает true = письмо доставлено.
 *
 * ВАЖНО (осознанный компромисс): захват идёт ДО send, поэтому крэш процесса между
 * claim и завершением send оставит строку в `sent:true` без письма — ретрай этой
 * недели потеряется. Это равнозначно поведению claim-before-send ДО outbox-волны
 * (там письмо тоже терялось на сбое) и цена at-most-once под конкуренцией.
 */
async function claimAndSend(cfg: DigestConfig, ctx: DeliverCtx, input: DeliverInput, id: string): Promise<boolean> {
  const won = await claimDigestSend(id);
  if (!won) return false; // захват проиграли — письмо отправит победитель
  try {
    const ok = await deliverDigest(cfg, ctx, input);
    if (!ok) await releaseDigestSend(id);
    return ok;
  } catch (e) {
    await releaseDigestSend(id); // откат перед пробросом — per-user catch залогирует
    throw e;
  }
}

export async function runWeeklyDigest(
  now: Date = new Date(),
): Promise<WeeklyDigestResult> {
  const cfg = emailDigestConfig();
  if (cfg === null) {
    // Фича выключена — ничего не пишем и не шлём (прод без ключей неизменен).
    return { skipped: "not_configured", candidates: 0, notified: 0, sent: 0, optedOut: 0, capped: 0, retried: 0 };
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
  const weekStart = windowStartIso.slice(0, 10);
  const weekEnd = windowEndIso.slice(0, 10);
  const weekKey = isoWeekKey(now); // ключ атомарного claim: одно письмо на (user, ISO-week)
  const site = publicSiteUrl();
  const secret = cronSecret();
  const ctx: DeliverCtx = { now, site, secret, weekStart, weekEnd };

  let notified = 0;
  let sent = 0;
  let optedOut = 0;
  let emailsAttempted = 0; // реальные попытки sendEmail — бюджет ретрая (Brevo cap)

  // Основной проход по свежим кандидатам. Может быть пуст (новых нет), но outbox-
  // ретрай ниже всё равно добирает недоставленные claim-строки этой недели.
  if (processed.length > 0) {
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
        // rating обязателен в data — источник Δ следующей недели, ratingDelta —
        // чтобы outbox-ретрай пересобрал письмо без повторного prior-запроса.
        const [claimed] = await db
          .insert(notification)
          .values({
            userId: c.userId,
            type: DIGEST_TYPE,
            kind: DIGEST_TYPE, // 0046: без явного kind прямой insert дал бы '' (дрейф с backfill)
            title: "Your weekly IELTS digest",
            body: null,
            data: {
              week: weekKey,
              rating: c.rating,
              ratingDelta,
              testsCount: stats.testsCount,
              avgBand: stats.avgBand,
              avgPercent: stats.avgPercent,
              sent: false, // outbox-lite: pending; успешная доставка флипнет в true
            },
          })
          .onConflictDoNothing()
          .returning({ id: notification.id });

        // Пустой returning → юзера уже заклеймил параллельный прогон → не письмо, не счётчик.
        // Ошибка вставки (не конфликт) уйдёт в catch ниже → тоже без отправки (fail-closed:
        // нет ledger — нет письма).
        if (!claimed) continue;
        notified += 1;

        // opt-out и нет-адреса — терминальны: письма не будет никогда, флипаем в
        // sent=true, чтобы ретрай их не подхватывал.
        if (c.optOut) {
          optedOut += 1;
          await claimDigestSend(claimed.id);
          continue;
        }
        if (!c.email) {
          await claimDigestSend(claimed.id);
          continue;
        }

        emailsAttempted += 1;
        // Атомарный claim-before-send: письмо шлёт ровно один параллельный прогон,
        // при сбое строка откатывается в pending → её добёрт ретрай.
        const ok = await claimAndSend(cfg, ctx, {
          userId: c.userId,
          email: c.email,
          rating: c.rating,
          ratingDelta,
          testsCount: stats.testsCount,
          avgBand: stats.avgBand,
          avgPercent: stats.avgPercent,
        }, claimed.id);
        if (ok) sent += 1;
      } catch (e) {
        // Без PII: userId ок, email не логируем (гигиена, как в send.ts).
        console.error("runWeeklyDigest: per-user failure", {
          userId: c.userId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // --- Outbox-retry (без миграции) ---
  // claim-строки ЭТОЙ недели в состоянии pending (`sent = false`) = недоставленные
  // прошлыми прогонами (свежие только что флипнуты в true выше; legacy-строки без
  // ключа исключены). Ре-отправляем best-effort, суммарно не превышая RUN_CAP за
  // прогон (Brevo cap). Double-send под конкуренцией закрыт атомарным claimAndSend.
  // opt-out/unconfirmed/null-email НЕ фильтруем в SQL, а тянем флаги и терминально
  // флипаем в цикле — иначе строка юзера, ставшего opt-out ПОСЛЕ claim, залипла бы
  // в pending навсегда.
  let retried = 0;
  const retryBudget = RUN_CAP - emailsAttempted;
  if (retryBudget > 0) {
    const processedSet = new Set(processed.map((c) => c.userId));
    const retryRows = await db
      .select({
        id: notification.id,
        userId: notification.userId,
        email: authUsers.email,
        emailConfirmedAt: authUsers.emailConfirmedAt,
        optOut: profile.weeklyDigestOptOut,
        data: notification.data,
      })
      .from(notification)
      .innerJoin(authUsers, eq(authUsers.id, notification.userId))
      .innerJoin(profile, eq(profile.id, notification.userId))
      .where(
        and(
          eq(notification.type, DIGEST_TYPE),
          sql`${notification.data}->>'week' = ${weekKey}`,
          sql`${notification.data}->>'sent' = 'false'`,
        ),
      )
      .orderBy(notification.createdAt)
      .limit(retryBudget);

    for (const r of retryRows) {
      // Уже трогали в этом прогоне (свежий сбой) — ждём следующего, без немедленного
      // ре-хита провайдера.
      if (processedSet.has(r.userId)) continue;
      if (!digestNeedsRetry(r.data, weekKey)) continue; // защита поверх SQL
      // Терминальные: юзер стал opt-out / email не подтверждён / нет адреса ПОСЛЕ
      // claim — письма не будет никогда, флипаем sent=true, чтобы не залипало в pending.
      if (r.optOut || r.emailConfirmedAt == null || !r.email) {
        await claimDigestSend(r.id);
        continue;
      }
      const stats = parseDigestClaimStats(r.data);
      if (stats === null) continue; // кривой data — письмо не собрать, оставляем как есть
      try {
        const ok = await claimAndSend(cfg, ctx, { userId: r.userId, email: r.email, ...stats }, r.id);
        if (ok) retried += 1;
      } catch (e) {
        console.error("runWeeklyDigest: retry failure", {
          userId: r.userId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return { candidates: total, notified, sent, optedOut, capped, retried };
}
