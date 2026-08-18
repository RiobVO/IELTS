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
import { BASIC_DAILY_LIMIT, effectiveTier, meetsTier, type Tier } from "@/lib/tiers";
import { FULL_CATEGORIES, isFullCategory, trialAllows } from "./trial";

/** Режим попытки (P0): серверная сущность, выбирается ДО создания attempt. */
export type AttemptMode = "practice" | "mock";

/** `db` ИЛИ активная транзакция — чтобы запросы гейта работали и внутри db.transaction. */
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

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
   * P0: дневной кап Basic считает и гейтит ТОЛЬКО СОЗДАНИЕ НОВОГО mock
   * (practice бесплатен и безлимитен; анти-абуз держит submit-throttle).
   * `null` = tier-гейт без капа — три легитимных случая: экран выбора режима
   * (mode ещё не выбран), резюм существующей попытки (новый слот не расходуется)
   * и submit (кап гейтит старты, не завершения — иначе доделанный mock терялся
   * бы на редиректе, у iframe-раннера ответы не автосейвятся).
   */
  mode: AttemptMode | null,
  /**
   * F4 "Sit as student": true ТОЛЬКО когда caller уже подтвердил isAdmin И тест —
   * черновик (см. loadAccessData.adminDraftBypass / инлайн-эквивалент в
   * exam/reading page.tsx). Гейтить деньгами QA-прогон теста, которым ЕЩЁ не
   * торгуют, бессмысленно — пропускаем тир И дневной кап целиком. Никогда true
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
 * SECURITY: assumes the caller has ALREADY run `enforceAccess()` — this function
 * does NOT gate tier/daily-limit. It is reachable only from the server-trusted RSC
 * pages (never a client-callable action), so the gate cannot be bypassed by calling
 * it directly.
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
  isTrial = false,
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
   */
  resume?: { id: string; mode: AttemptMode; answers: Record<string, string | string[]> } | null,
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

  // Trial-старт: атомарный claim единственного trial-слота юзера через trial_claim
  // (0054) вместо блокирующего advisory-xact-lock. PK(user_id) сериализует
  // конкурентные старты РАЗНЫХ full mock: второй INSERT ждёт row-lock ключа до
  // commit первого, затем ловит ON CONFLICT DO NOTHING (пустой RETURNING) — без
  // удержания advisory-лока на server-connection пула pgbouncer.
  if (isTrial) {
    return db.transaction(async (tx) => {
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
      return openNewAttempt(tx, userId, contentItemId, modeIfNew);
    });
  }
  return openNewAttempt(db, userId, contentItemId, modeIfNew);
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
