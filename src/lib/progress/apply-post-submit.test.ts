// Юнит-тесты транзакционной прогрессии applyPostSubmit (BRIEF §4.6): RATED-обвязка
// (Elo-обмен + новая difficulty теста, только первая сданная попытка) и STREAK-
// переходы (keep / +1 / reset по UTC-календарному дню). Вся эта read-modify-write
// логика жила без единого юнита.
//
// Стратегия мока (стиль access.test.ts): db.transaction зовёт cb с фейковым tx,
// делящим select-очередь (порядок строго по РЕАЛЬНЫМ вызовам: profile FOR UPDATE ->
// count -> [contentItem FOR UPDATE только если rated]); tx.update(table).set(values)
// захватывается в updates[] с таблицей-идентичностью (реальный @/db/schema НЕ мокаем,
// сравниваем по ===). anti-cheat (shouldRateAttempt) и rating/elo (ratingDeltas,
// ELO_FLOOR) — РЕАЛЬНЫЕ импорты (уже покрыты своими юнитами, здесь считаем ими правду).
// Best-effort хвост (badges/referral/notifications/log) и after() замоканы в no-op —
// на возвращаемое значение и на записи в tx они не влияют.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { contentItem as contentItemTable, profile as profileTable } from "@/db/schema";
import { ELO_FLOOR } from "@/lib/rating/elo";

const txHolder = vi.hoisted(() => ({ tx: null as unknown }));

vi.mock("@/db", () => ({
  db: {
    // Реальный код: `await db.transaction(async (tx) => {...})`. Отдаём наш tx и
    // возвращаем промис колбэка как есть (await снаружи развернёт).
    transaction: (cb: (tx: unknown) => unknown) => cb(txHolder.tx),
  },
}));
// Best-effort хвост applyPostSubmit — импортируется на верхнем уровне, поэтому обязан
// резолвиться; логику этих веток здесь не проверяем, только изолируем.
vi.mock("./badges", () => ({ evaluateBadges: vi.fn(() => Promise.resolve([])) }));
vi.mock("./referral", () => ({ maybeRewardReferral: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/notifications/create", () => ({ createNotifications: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/monitoring/log-error", () => ({ logError: vi.fn(() => Promise.resolve()) }));
// after() вне request-скоупа Next бросает; deferred-работу здесь не проверяем — no-op,
// не вызывая колбэк (createNotifications/maybeRewardReferral остаются нетронутыми).
vi.mock("next/server", () => ({ after: vi.fn() }));

import { applyPostSubmit, type PostSubmitInput } from "./apply-post-submit";

// --- Фейковый tx: select-очередь + захват update().set() -----------------------
interface UpdateCapture {
  table: unknown;
  set: Record<string, unknown>;
}
type ProfileRow = {
  rating: number;
  peakRating: number;
  ratedCount: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | Date | null;
};

// `.from().where().limit().for()` -> Promise<rows> (profile-lock и contentItem-lock).
const forUpdateChain = (rows: unknown[]) => ({
  from: () => ({ where: () => ({ limit: () => ({ for: () => Promise.resolve(rows) }) }) }),
});
// `.from().where()` -> Promise<rows> (count-запрос, без limit/for).
const whereChain = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });

function buildTx(rows: {
  profile: ProfileRow | null;
  count: number;
  contentItem?: { difficultyRating: number | null; difficultyCount: number };
}): { tx: unknown; updates: UpdateCapture[] } {
  const updates: UpdateCapture[] = [];
  // Порядок ровно как в apply-post-submit.ts: profile FOR UPDATE, затем count,
  // затем (только в rated-ветке) contentItem FOR UPDATE. 3-й фактор не потребляется,
  // если rated=false — это ОК.
  const queue: Array<() => unknown> = [
    () => forUpdateChain(rows.profile ? [rows.profile] : []),
    () => whereChain([{ n: rows.count }]),
    () => forUpdateChain(rows.contentItem ? [rows.contentItem] : []),
  ];
  let i = 0;
  const tx = {
    select: () => {
      const factory = queue[i++];
      if (!factory) throw new Error(`unexpected tx.select call #${i}`);
      return factory();
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table, set: values });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { tx, updates };
}

function makeInput(over: Partial<PostSubmitInput> = {}): PostSubmitInput {
  return {
    userId: "u1",
    contentItemId: "item1",
    attemptId: "att1",
    mode: "mock",
    rawScore: 30,
    total: 40,
    timeUsedSeconds: 1200, // >> 40*3 -> НЕ too-fast, floor-guard не режет рейтинг
    submittedAt: new Date("2026-07-19T12:00:00.000Z"),
    ...over,
  };
}

const setOf = (updates: UpdateCapture[], table: unknown) =>
  updates.find((u) => u.table === table)?.set;

beforeEach(() => {
  txHolder.tx = null;
  vi.clearAllMocks();
});

// ============================================================================
// [H] RATED-обвязка (apply-post-submit.ts:116-173)
// ============================================================================
describe("applyPostSubmit — RATED-обвязка", () => {
  it("count===1 ∧ mock ∧ честный темп -> дельты применены точно + новая сложность теста", async () => {
    // lastActivityDate=today -> стрик стоит, изолируем рейтинг.
    // Elo вручную: expected(1000,1000)=0.5; performance=30/40=0.75;
    // userDelta=round(24*(0.75-0.5))=round(6)=6; newRating=max(100,1000+6)=1006;
    // testDelta=-6; newDifficulty=max(100,1000-6)=994.
    const { tx, updates } = buildTx({
      profile: {
        rating: 1000,
        peakRating: 1000,
        ratedCount: 5,
        currentStreak: 3,
        longestStreak: 10,
        lastActivityDate: "2026-07-19",
      },
      count: 1,
      contentItem: { difficultyRating: 1000, difficultyCount: 20 },
    });
    txHolder.tx = tx;

    const result = await applyPostSubmit(makeInput({ rawScore: 30, total: 40 }));

    expect(setOf(updates, profileTable)).toMatchObject({
      rating: 1006,
      peakRating: 1006, // max(1000, 1006) — пик двинулся вверх
      ratedCount: 6,
    });
    expect(setOf(updates, contentItemTable)).toMatchObject({
      difficultyRating: 994,
      difficultyCount: 21,
    });
    expect(result).toMatchObject({ rated: true, ratingDelta: 6, newRating: 1006, awardedBadges: [] });
  });

  it("рейтинг у пола: результат ниже ELO_FLOOR клэмпится на ELO_FLOOR (сложность растёт)", async () => {
    // expected(100,100)=0.5; performance=0; userDelta=round(24*(0-0.5))=-12;
    // 100-12=88 < FLOOR(100) -> clamp до 100. testDelta=+12 -> newDifficulty=112.
    const { tx, updates } = buildTx({
      profile: {
        rating: 100,
        peakRating: 100,
        ratedCount: 0,
        currentStreak: 1,
        longestStreak: 1,
        lastActivityDate: "2026-07-19",
      },
      count: 1,
      contentItem: { difficultyRating: 100, difficultyCount: 4 },
    });
    txHolder.tx = tx;

    const result = await applyPostSubmit(makeInput({ rawScore: 0, total: 40 }));

    expect(setOf(updates, profileTable)?.rating).toBe(ELO_FLOOR); // 88 зажат до 100
    expect(setOf(updates, profileTable)).toMatchObject({ peakRating: 100, ratedCount: 1 });
    expect(setOf(updates, contentItemTable)).toMatchObject({
      difficultyRating: 112, // сложность теста НЕ зажата (112 > FLOOR)
      difficultyCount: 5,
    });
    // Fix 2026-07-19: ratingDelta — ФАКТИЧЕСКОЕ изменение (newRating - oldRating),
    // не сырая userDelta: на полу ELO_FLOOR result-страница показывала «-12» при
    // реально неизменном рейтинге.
    expect(result).toMatchObject({ rated: true, ratingDelta: 0, newRating: 100 });
  });

  it("count>1 (не первая сданная попытка) -> rating-ветка НЕ исполняется, contentItem не трогается", async () => {
    const { tx, updates } = buildTx({
      profile: {
        rating: 1000,
        peakRating: 1000,
        ratedCount: 5,
        currentStreak: 3,
        longestStreak: 10,
        lastActivityDate: "2026-07-19",
      },
      count: 2, // вторая сданная -> shouldRateAttempt=false
    });
    txHolder.tx = tx;

    const result = await applyPostSubmit(makeInput({ mode: "mock" }));

    // Профиль пишется (стрик/XP всегда), но рейтинг/пик/ratedCount не сдвинуты.
    expect(setOf(updates, profileTable)).toMatchObject({
      rating: 1000,
      peakRating: 1000,
      ratedCount: 5,
    });
    // contentItem не апдейтился вовсе (единственный update — по profile).
    expect(updates.some((u) => u.table === contentItemTable)).toBe(false);
    expect(result).toMatchObject({ rated: false, ratingDelta: 0, newRating: 1000 });
  });

  it("mode='practice' даже на первой попытке -> НЕ рейтингуется (practice сжигает рейтингуемость)", async () => {
    const { tx, updates } = buildTx({
      profile: {
        rating: 1000,
        peakRating: 1000,
        ratedCount: 5,
        currentStreak: 3,
        longestStreak: 10,
        lastActivityDate: "2026-07-19",
      },
      count: 1, // первая сданная, но mode=practice
    });
    txHolder.tx = tx;

    const result = await applyPostSubmit(makeInput({ mode: "practice" }));

    expect(setOf(updates, profileTable)).toMatchObject({ rating: 1000, ratedCount: 5 });
    expect(updates.some((u) => u.table === contentItemTable)).toBe(false);
    expect(result).toMatchObject({ rated: false, ratingDelta: 0 });
  });

  it("слишком быстрый сабмит (floor-guard по темпу) -> mock+первая, но НЕ рейтингуется", async () => {
    // timeUsedSeconds < total*3 (40*3=120) -> isTooFastToRate -> shouldRateAttempt=false.
    const { tx, updates } = buildTx({
      profile: {
        rating: 1000,
        peakRating: 1000,
        ratedCount: 5,
        currentStreak: 3,
        longestStreak: 10,
        lastActivityDate: "2026-07-19",
      },
      count: 1,
    });
    txHolder.tx = tx;

    const result = await applyPostSubmit(makeInput({ mode: "mock", timeUsedSeconds: 5 }));

    expect(setOf(updates, profileTable)).toMatchObject({ rating: 1000, ratedCount: 5 });
    expect(updates.some((u) => u.table === contentItemTable)).toBe(false);
    expect(result).toMatchObject({ rated: false, ratingDelta: 0 });
  });
});

// ============================================================================
// [M] STREAK-переходы (apply-post-submit.ts:96-106)
// ============================================================================
// Стрик считается по UTC-календарному дню и полностью детерминирован входами:
// today = utcDay(submittedAt), last = asDayString(lastActivityDate). Fake timers
// НЕ нужны — обе даты задаём явно. mode='practice' -> rated=false, единственный
// update по profile, изолирует стрик от рейтинга.
describe("applyPostSubmit — STREAK-переходы", () => {
  const streakInput = (over: Partial<PostSubmitInput> = {}) =>
    makeInput({ mode: "practice", ...over });

  it("lastActivity === today (тот же UTC-день) -> currentStreak НЕ меняется; longest держится", async () => {
    const { tx, updates } = buildTx({
      profile: {
        rating: 1000,
        peakRating: 1000,
        ratedCount: 0,
        currentStreak: 5,
        longestStreak: 10,
        lastActivityDate: "2026-07-19",
      },
      count: 1,
    });
    txHolder.tx = tx;

    await applyPostSubmit(streakInput({ submittedAt: new Date("2026-07-19T12:00:00.000Z") }));

    // keep: 5 остаётся 5; longest max(10,5)=10 (не тянется вниз).
    expect(setOf(updates, profileTable)).toMatchObject({ currentStreak: 5, longestStreak: 10 });
  });

  it("lastActivity === вчера по UTC (граница суток, разница 1 час) -> currentStreak+1; longest растёт", async () => {
    // submittedAt 00:30 UTC 07-19, lastActivity как Date 23:30 UTC 07-18 — всего час
    // назад, но ПРЕДЫДУЩИЙ UTC-день -> засчитывается как consecutive (день, не 24ч-окно).
    const { tx, updates } = buildTx({
      profile: {
        rating: 1000,
        peakRating: 1000,
        ratedCount: 0,
        currentStreak: 5,
        longestStreak: 5,
        lastActivityDate: new Date("2026-07-18T23:30:00.000Z"),
      },
      count: 1,
    });
    txHolder.tx = tx;

    await applyPostSubmit(streakInput({ submittedAt: new Date("2026-07-19T00:30:00.000Z") }));

    // +1: 5 -> 6; longest max(5,6)=6 (новый current превысил -> обновился).
    expect(setOf(updates, profileTable)).toMatchObject({ currentStreak: 6, longestStreak: 6 });
  });

  it("lastActivity старше вчера (пропуск дней) -> reset до 1; longest держится", async () => {
    const { tx, updates } = buildTx({
      profile: {
        rating: 1000,
        peakRating: 1000,
        ratedCount: 0,
        currentStreak: 9,
        longestStreak: 9,
        lastActivityDate: "2026-07-10",
      },
      count: 1,
    });
    txHolder.tx = tx;

    await applyPostSubmit(streakInput({ submittedAt: new Date("2026-07-19T12:00:00.000Z") }));

    // reset: 9 -> 1; longest max(9,1)=9 (текущий не превысил -> НЕ обновился).
    expect(setOf(updates, profileTable)).toMatchObject({ currentStreak: 1, longestStreak: 9 });
  });

  it("lastActivity === null (первая активность) -> currentStreak=1; longest держится", async () => {
    const { tx, updates } = buildTx({
      profile: {
        rating: 1000,
        peakRating: 1000,
        ratedCount: 0,
        currentStreak: 4, // мусорное «до» — reset-ветка обнулит
        longestStreak: 8,
        lastActivityDate: null,
      },
      count: 1,
    });
    txHolder.tx = tx;

    await applyPostSubmit(streakInput({ submittedAt: new Date("2026-07-19T12:00:00.000Z") }));

    expect(setOf(updates, profileTable)).toMatchObject({ currentStreak: 1, longestStreak: 8 });
  });
});
