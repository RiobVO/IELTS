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
import { and, count, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import { attempt, contentItem, profile, trialClaim } from "@/db/schema";
import { captureServer } from "@/lib/analytics/server";
import { isAdminProfile } from "@/lib/auth";
import { BASIC_PRACTICE_DAILY_LIMIT, BASIC_MOCK_WEEKLY_LIMIT, effectiveTier, meetsTier, type Tier } from "@/lib/tiers";
import { FULL_CATEGORIES, isFullCategory, trialAllows } from "./trial";

/** Режим попытки (P0): серверная сущность, выбирается ДО создания attempt. */
export type AttemptMode = "practice" | "mock";

/** `db` ИЛИ активная транзакция — чтобы запросы гейта работали и внутри db.transaction. */
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * "Сегодня" — простая UTC-полночь (серверные часы, НЕ таймзона юзера). Basic-
 * капы никогда не были tz-aware — сознательно не тащим profile.timezone в гейт
 * ради лишней точности, которую спека не просила.
 */
export function dayStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * ISO-неделя с понедельника, тот же UTC-якорь «сегодня», что dayStartUtc — та
 * же mondayOffset-математика, что isInCurrentTzWeek (progress/exam-countdown.ts),
 * без таймзоны юзера (см. dayStartUtc).
 */
export function weekStartUtc(now: Date): Date {
  const day = dayStartUtc(now);
  const dow = day.getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = (dow + 6) % 7; // 0=Mon..6=Sun
  return new Date(day.getTime() - mondayOffset * 24 * 60 * 60 * 1000);
}

/**
 * Read the access facts for (user, test) via the owner db: the user's effective
 * tier, the test's required tier, and the band scale (the last is submit-only but
 * read here so submit needs a SINGLE content_item round-trip, not two). Returns
 * null if either row is missing. No redirects — separated from enforcement so the
 * reads can be batched with submit's other independent queries.
 *
 * F4 "Sit as student": the content_item query no longer filters status='published'
 * in SQL — instead the published-gate is applied AFTER the read, so an admin can be
 * exempted with zero extra round-trips (profile.role rides along the SAME profile
 * select that already ran here). Non-admin behaviour is byte-identical to before
 * (draft/unpublished id -> null, same as the old WHERE-clause gate).
 */
export async function loadAccessData(
  userId: string,
  contentItemId: string,
): Promise<{
  userTier: Tier;
  tierRequired: Tier;
  category: string;
  bandScale: Record<string, number> | null;
  /** true только когда юзер — admin И тест ещё не опубликован (F4). Сигнал для
   *  enforceAccess: QA-прогон черновика вне монетизации (тир/дневной кап
   *  неприменимы к тесту, который ещё не продаётся). Никогда true для студента
   *  или опубликованного теста. */
  adminDraftBypass: boolean;
} | null> {
  const [[prof], [item]] = await Promise.all([
    db
      .select({ tier: profile.tier, premiumUntil: profile.premiumUntil, role: profile.role })
      .from(profile)
      .where(eq(profile.id, userId)),
    db
      .select({
        tierRequired: contentItem.tierRequired,
        category: contentItem.category,
        bandScale: contentItem.bandScale,
        status: contentItem.status,
      })
      .from(contentItem)
      .where(eq(contentItem.id, contentItemId)),
  ]);
  if (!prof || !item) return null;
  const admin = isAdminProfile(prof);
  // Owner-path bypasses RLS, so gate published HERE too: a draft/unpublished id
  // never resolves for a non-admin -> caller redirects away, byte-identical to the
  // old WHERE-clause gate. Admin is exempted (F4) — the only behaviour change.
  if (item.status !== "published" && !admin) return null;
  return {
    userTier: effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil }),
    tierRequired: item.tierRequired,
    category: item.category,
    bandScale: (item.bandScale as Record<string, number> | null) ?? null,
    adminDraftBypass: admin && item.status !== "published",
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
  /** Категория теста — из content_item (owner-path), НЕ из client-input: решает,
   *  применим ли trial-лейн (только полный тест). */
  category: string,
  /** id текущего теста — trial-запрос исключает его попытки (свой trial не расход). */
  contentItemId: string,
  /**
   * Basic caps считают и гейтят ТОЛЬКО СОЗДАНИЕ НОВОГО attempt — 2
   * practice/день + 2 mock/неделю (owner decision 2026-07-17; анти-абуз сверх
   * этого держит submit-throttle). `null` = tier-гейт без капа — три
   * легитимных случая: экран выбора режима (mode ещё не выбран), резюм
   * существующей попытки (новый слот не расходуется) и submit (кап гейтит
   * старты, не завершения — иначе доделанный тест терялся бы на редиректе, у
   * iframe-раннера ответы не автосейвятся).
   */
  mode: AttemptMode | null,
  /**
   * F4 "Sit as student": true ТОЛЬКО когда caller уже подтвердил isAdmin И тест —
   * черновик (см. loadAccessData.adminDraftBypass / инлайн-эквивалент в
   * exam/reading page.tsx). Гейтить деньгами QA-прогон теста, которым ЕЩЁ не
   * торгуют, бессмысленно — пропускаем тир И оба капа целиком. Никогда true
   * для студента или опубликованного теста, поэтому обычный путь не меняется.
   */
  adminDraftBypass = false,
): Promise<void> {
  if (adminDraftBypass) return;

  // (a) Tier gate + trial-лейн (§4.8). Обычный tier-гейт закрыл бы полный тест для
  // Basic — trial-лейн пропускает ОДИН (лендинг «first full test is free»).
  // DB-запрос «израсходован ли trial» делаем ТОЛЬКО когда он реально может помочь
  // (Basic + полный тест); иначе лишний RT не нужен — trialAllows и так даст deny.
  if (!meetsTier(userTier, tierRequired)) {
    const maybeTrial = userTier === "basic" && isFullCategory(category);
    const trialConsumed = maybeTrial
      ? await hasConsumedTrial(userId, contentItemId)
      : true;
    if (!trialAllows({ userTier, tierRequired, category, trialConsumed })) {
      redirect("/app/upgrade");
    }
  }

  // (b) Basic caps (owner decision 2026-07-17, replaces the old 25/day mock-only
  // cap now that R/L content itself is free): 2 practice starts/day + 2 mock
  // starts/week, combined across Reading+Listening (attempt rows aren't scoped
  // to a section, so no join/filter needed for that). Counts STARTS — any
  // attempt row with startedAt in the window, regardless of status — not just
  // submitted, so the cap can't be dodged by never submitting. `mode` is null
  // for resume/submit (callers already pass `existing ? null : modeParam`), so
  // this never re-charges a resumed or completed attempt. Premium/Ultra never
  // reach here (userTier==="basic" gate) — unlimited either way.
  //
  // SOFT check only — an early, best-effort redirect so a doomed request fails
  // fast without wasting work (audio fetch, sanitize, etc). It is NOT the
  // source of truth: two concurrent starts can both COUNT "1 of 2 used" here
  // and both pass, then both INSERT — a classic check-then-act race (Codex
  // review 2026-07-17 blocker). The AUTHORITATIVE re-check is transactional,
  // inside startAttempt (see the row-lock there) — this one only makes the
  // common (non-racing) case redirect before the heavier work below runs.
  if (userTier === "basic" && mode != null) {
    const now = new Date();
    if (mode === "practice") {
      const dayStart = dayStartUtc(now);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const [usage] = await db
        .select({ n: count() })
        .from(attempt)
        .where(
          and(
            eq(attempt.userId, userId),
            eq(attempt.mode, "practice"),
            gte(attempt.startedAt, dayStart),
            lt(attempt.startedAt, dayEnd),
          ),
        );
      if ((usage?.n ?? 0) >= BASIC_PRACTICE_DAILY_LIMIT) {
        // cap_hit (§11): отказ по капу иначе НИГДЕ не виден (заблокированный старт
        // не пишет строку attempt) — без события нельзя судить, работает ли кап
        // как двигатель апгрейда. after() — как test_start: телеметрия не
        // блокирует ответ; redirect() бросает, поэтому регистрируем ДО него.
        after(() => captureServer("cap_hit", userId, { mode: "practice", scope: "daily", check: "soft" }));
        redirect("/app/practice?limit=practice");
      }
    } else {
      const weekStart = weekStartUtc(now);
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const [usage] = await db
        .select({ n: count() })
        .from(attempt)
        .where(
          and(
            eq(attempt.userId, userId),
            eq(attempt.mode, "mock"),
            gte(attempt.startedAt, weekStart),
            lt(attempt.startedAt, weekEnd),
          ),
        );
      if ((usage?.n ?? 0) >= BASIC_MOCK_WEEKLY_LIMIT) {
        // cap_hit — зеркало practice-ветки выше (см. комментарий там).
        after(() => captureServer("cap_hit", userId, { mode: "mock", scope: "weekly", check: "soft" }));
        redirect("/app/practice?limit=mock");
      }
    }
  }
}

/**
 * Израсходован ли trial-лейн (§4.8): есть ли у юзера attempt на полном tier-
 * гейтнутом тесте (category full_*, tier_required выше basic), считающийся расходом.
 * Расход = попытка на ДРУГОМ таком тесте ЛИБО СДАННАЯ (submitted) на ТЕКУЩЕМ item.
 * Исключается только СОБСТВЕННАЯ in_progress текущего item — чтобы резюм/submit
 * своего trial жили; submitted текущего = расход (иначе бесконечные бесплатные
 * ретейки того же full mock). owner-path (Drizzle bypass RLS); attempt.user_id
 * индексирован, JOIN по PK, LIMIT 1 — один RT. `exec` — db или tx (H3 recheck под локом).
 */
export async function hasConsumedTrial(
  userId: string,
  currentContentItemId: string,
  exec: DbExecutor = db,
): Promise<boolean> {
  const [row] = await exec
    .select({ id: attempt.id })
    .from(attempt)
    .innerJoin(contentItem, eq(contentItem.id, attempt.contentItemId))
    .where(
      and(
        eq(attempt.userId, userId),
        ne(contentItem.tierRequired, "basic"),
        inArray(contentItem.category, [...FULL_CATEGORIES]),
        or(
          ne(attempt.contentItemId, currentContentItemId),
          eq(attempt.status, "submitted"),
        ),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Незакрытая попытка этого (user, test) — страницы решают по ней, показывать ли
 * экран выбора режима (нет попытки и нет ?mode= → выбор) или резюмить с режимом,
 * зафиксированным при создании. Отдельный лёгкий SELECT по partial-индексу 0007,
 * батчится страницей с остальными независимыми чтениями. `answers` читаются
 * сразу же: страница передаёт строку в startAttempt (параметр `resume`), и тот
 * резюмит без повторного SELECT той же строки — минус серийный round-trip.
 */
export async function findInProgressAttempt(
  userId: string,
  contentItemId: string,
): Promise<{ id: string; mode: AttemptMode; answers: Record<string, string | string[]> } | null> {
  const [row] = await db
    .select({ id: attempt.id, mode: attempt.mode, answers: attempt.answers })
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
  if (!row) return null;
  return {
    id: row.id,
    mode: row.mode,
    answers: (row.answers as Record<string, string | string[]>) ?? {},
  };
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
 * SECURITY: assumes the caller has ALREADY run `enforceAccess()` for the tier
 * gate. Basic's practice/mock cap, though, is authoritatively enforced HERE —
 * the transactional row-lock re-check below (`enforceAccess`'s own cap check
 * is only a soft, best-effort early redirect). It is reachable only from the
 * server-trusted RSC pages (never a client-callable action), so neither gate
 * can be bypassed by calling it directly.
 */
type StartResult = {
  attemptId: string;
  answers: Record<string, string | string[]>;
  mode: AttemptMode;
};

export async function startAttempt(
  userId: string,
  contentItemId: string,
  /** Режим НОВОЙ попытки; существующая in_progress резюмится со СВОИМ mode. */
  modeIfNew: AttemptMode,
  /**
   * H3: доступ выдан trial-лейном (§4.8), не по тиру. Создание НОВОЙ попытки тогда
   * атомарно по юзеру — claim единственного trial-слота через trial_claim
   * (PK user_id, ON CONFLICT DO NOTHING), иначе два параллельных старта РАЗНЫХ full
   * mock оба пройдут (partial-индекс 0007 держит только (user,item)). Резюм
   * существующей попытки — БЕЗ claim (ранний return по `resume`).
   */
  isTrial: boolean,
  /**
   * Результат страничного findInProgressAttempt из ТОГО ЖЕ запроса: объект →
   * резюмим его без повторного SELECT той же строки (страница уже решила mode по
   * нему — единый снимок согласованнее, чем второе чтение); null → попытки нет,
   * идём сразу на вставку (гонку параллельных стартов разруливает
   * onConflictDoNothing в openNewAttempt); undefined → легаси-путь, ищем сами.
   *
   * Multi-tab TOCTOU: снимок может отстать от параллельной вкладки на ~1 RT — как
   * и прежний повторный SELECT, живший на RT позже батча; окно свойственно
   * полнообъектному автосейву на протяжении всей сессии, а целостность держат
   * WHERE status='in_progress' в saveProgress и single-fire claim сабмита.
   *
   * Не помечен `?` (Codex review 2026-07-17, major #2 — required parameter не
   * может идти следом за optional): caller обязан передать явно, undefined
   * включая — три состояния типа те же, просто без синтаксиса «можно
   * пропустить позиционный аргумент».
   */
  resume: { id: string; mode: AttemptMode; answers: Record<string, string | string[]> } | null | undefined,
  /**
   * Эффективный тир юзера — нужен ЗДЕСЬ (не только в enforceAccess), потому что
   * АВТОРИТЕТНАЯ проверка Basic-капа (2 practice/день + 2 mock/неделю) живёт на
   * insert-пути, внутри транзакции ниже (см. её комментарий про row-lock).
   * enforceAccess's собственная проверка — только ранний soft-редирект, гонку
   * не закрывает. Premium/Ultra = кап неприменим. ОБЯЗАТЕЛЬНЫЙ параметр (Codex
   * review 2026-07-17, major #2): дефолта "ultra" больше нет — забытый аргумент
   * на вызывающей стороне обязан быть compile-error, а не тихим снятием капа
   * (раньше отсутствие аргумента молча трактовалось как paid-тир).
   */
  userTier: Tier,
): Promise<StartResult> {
  if (resume) {
    return { attemptId: resume.id, answers: resume.answers, mode: resume.mode };
  }
  if (resume === undefined) {
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
  }

  const needsCapCheck = userTier === "basic";
  // Fast path: nothing to serialize (paid tier, non-trial) — skip the
  // transaction entirely, same as before this change.
  if (!isTrial && !needsCapCheck) {
    return openNewAttempt(db, userId, contentItemId, modeIfNew);
  }

  return db.transaction(async (tx) => {
    // Lock order invariant (Codex review 2026-07-17, major #1): profile FIRST,
    // ALWAYS, before ANYTHING else in this transaction — in particular before
    // the trialClaim insert below, whose FK to content_item takes a share-lock
    // on that content_item row. apply-post-submit.ts documents the same
    // invariant ("Lock order is always profile -> content_item") for its own
    // rated-submit transaction; unifying on ONE global order across every
    // transaction that can lock both tables is what actually prevents a
    // deadlock — two transactions racing in OPPOSITE lock orders is the classic
    // deadlock shape, not a risk either transaction alone would show.
    await tx.select({ id: profile.id }).from(profile).where(eq(profile.id, userId)).limit(1).for("update");

    // Re-check under the lock (Codex review 2026-07-17, minor #3): every start
    // for THIS user — any item — is now serialized behind the profile lock
    // above, so if a concurrent tab already committed an in_progress attempt
    // for THIS SAME item while we were waiting for the lock, it's visible now.
    // Must resume it INSTEAD of falling through to the cap-count below —
    // otherwise the loser of a same-item race gets wrongly cap-rejected for
    // something that isn't a new start at all, just a resume. (openNewAttempt's
    // own ON CONFLICT DO NOTHING is a second, redundant safety net for this
    // same race — kept as-is, cheap and harmless when this recheck already
    // caught it.)
    const [existingUnderLock] = await tx
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
    if (existingUnderLock) {
      return {
        attemptId: existingUnderLock.id,
        answers: (existingUnderLock.answers as Record<string, string | string[]>) ?? {},
        mode: existingUnderLock.mode,
      };
    }

    // Trial-старт: атомарный claim единственного trial-слота юзера через
    // trial_claim (0054) вместо блокирующего advisory-xact-lock. PK(user_id)
    // сериализует конкурентные старты РАЗНЫХ full mock: второй INSERT ждёт
    // row-lock ключа до commit первого, затем ловит ON CONFLICT DO NOTHING
    // (пустой RETURNING) — без удержания advisory-лока на server-connection
    // пула pgbouncer.
    if (isTrial) {
      const claimed = await tx
        .insert(trialClaim)
        .values({ userId, contentItemId })
        .onConflictDoNothing({ target: trialClaim.userId })
        .returning({ userId: trialClaim.userId });
      // Проиграл claim → слот уже занят (победителем гонки или прежним стартом этой
      // же сессии). Источник правды решения — прежний hasConsumedTrial (READ
      // COMMITTED: после commit победителя его attempt виден): расход на другом/
      // сданном тесте → redirect; собственный in_progress текущего item он
      // пропускает, а openNewAttempt резюмит его по partial-индексу 0007. Так claim
      // НЕ может дать ложный deny — только отсечь двойное открытие. Победитель
      // (claim создан) открывает сразу: enforceAccess уже прошёл (trial не
      // израсходован), а конкурентный расход был бы виден как проигрыш claim.
      if (claimed.length === 0 && (await hasConsumedTrial(userId, contentItemId, tx))) {
        redirect("/app/upgrade");
      }
    }

    // Basic cap — АВТОРИТЕТНАЯ проверка (Codex review 2026-07-17 blocker): the
    // COUNT in enforceAccess happens in its OWN, separate statement/round-trip
    // before this transaction even starts — two concurrent starts can both
    // read "1 of 2 used", both pass that soft check, then both reach here and
    // both INSERT (classic check-then-act race). A counting cap (up to N, not
    // a single slot) can't be modeled as one ON CONFLICT DO NOTHING insert
    // like trial_claim, so instead it's SERIALIZED for THIS user by the
    // profile row-lock taken at the top of this transaction (same technique
    // progress/apply-post-submit.ts already uses to serialize concurrent
    // submits of one user — profile is a natural one-row-per-user lock target,
    // no schema change needed). A concurrent start by a DIFFERENT user locks a
    // DIFFERENT row, so there's no cross-user contention. This is a
    // TRANSACTION-scoped row lock, released at COMMIT/ROLLBACK — deliberately
    // NOT a session-scoped advisory lock (pg_advisory_lock), which the trial
    // gate dropped for exactly this reason: it doesn't play safe with
    // pgbouncer transaction-mode pooling (the underlying connection can be
    // handed to another session between statements outside an explicit
    // transaction). A tx-scoped row lock lives and dies with THIS transaction,
    // so it's safe under transaction-mode pooling the same way trial_claim's
    // ON CONFLICT already is.
    if (needsCapCheck) {
      const limit = modeIfNew === "practice" ? BASIC_PRACTICE_DAILY_LIMIT : BASIC_MOCK_WEEKLY_LIMIT;
      const now = new Date();
      const windowStart = modeIfNew === "practice" ? dayStartUtc(now) : weekStartUtc(now);
      const windowDays = modeIfNew === "practice" ? 1 : 7;
      const windowEnd = new Date(windowStart.getTime() + windowDays * 24 * 60 * 60 * 1000);
      const [usage] = await tx
        .select({ n: count() })
        .from(attempt)
        .where(
          and(
            eq(attempt.userId, userId),
            eq(attempt.mode, modeIfNew),
            gte(attempt.startedAt, windowStart),
            lt(attempt.startedAt, windowEnd),
          ),
        );
      // Same notice/redirect path as enforceAccess's soft check, so a race
      // caught only here still lands the user on the exact same explanation.
      // cap_hit: сюда доходят только гонки, проскочившие soft-чек (в одном
      // запросе оба не сработают — soft-редирект не пускает до транзакции);
      // check:"authoritative" отличает их в телеметрии.
      if ((usage?.n ?? 0) >= limit) {
        after(() =>
          captureServer("cap_hit", userId, {
            mode: modeIfNew,
            scope: modeIfNew === "practice" ? "daily" : "weekly",
            check: "authoritative",
          }),
        );
        redirect(`/app/practice?limit=${modeIfNew}`);
      }
    }

    return openNewAttempt(tx, userId, contentItemId, modeIfNew);
  });
}

/**
 * Вставляет новую in_progress-попытку (или резюмит победителя гонки того же item) и
 * фейрит `test_start`. Выделено из startAttempt, чтобы non-trial и trial-под-локом
 * пути делили ОДНУ логику вставки; `exec` = db или транзакция (для trial-клейма).
 */
async function openNewAttempt(
  exec: DbExecutor,
  userId: string,
  contentItemId: string,
  modeIfNew: AttemptMode,
): Promise<StartResult> {
  const inserted = await exec
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
    const [winner] = await exec
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
