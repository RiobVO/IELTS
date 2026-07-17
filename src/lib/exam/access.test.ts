import { describe, it, expect, vi, beforeEach } from "vitest";

// F12: юнит-тесты на enforceAccess/loadAccessData (§4.8 tier-gate + adminDraftBypass,
// волна F). Мокаем @/db (select-цепочка, стиль publish.test.ts/persist.test.ts),
// next/navigation (redirect() в реальном Next.js бросает — здесь бросаем СВОЮ ошибку
// с адресом, чтобы assert'ить ТОЧНЫЙ redirect target) и @/lib/analytics/server
// (captureServer — импортируется access.ts на верхнем уровне и тянет @/env,
// который фейлит без реальных секретов; enforceAccess/loadAccessData её не зовут,
// но модуль обязан импортироваться без побочных эффектов).
const { select } = vi.hoisted(() => ({ select: vi.fn() }));
const redirectFn = vi.hoisted(() => vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
}));
// transaction — тот же приём, что persist.test.ts: cb вызывается с tx-объектом,
// делящим ОДНУ select-очередь с db.select (реальный код зовёт то db.select, то
// tx.select — порядок мока должен идти строго в порядке РЕАЛЬНЫХ вызовов).
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => select(...a),
    transaction: (cb: (tx: unknown) => unknown) => cb({ select: (...a: unknown[]) => select(...a) }),
  },
}));
vi.mock("next/navigation", () => ({ redirect: redirectFn }));
vi.mock("@/lib/analytics/server", () => ({ captureServer: vi.fn() }));

import { dayStartUtc, enforceAccess, loadAccessData, startAttempt, weekStartUtc } from "./access";

// (a) profile/count-запросы: .from().where() -> Promise<rows>.
const whereChain = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
// (b) hasConsumedTrial: .from().innerJoin().where().limit() -> Promise<rows>.
const trialChain = (rows: unknown[]) => ({
  from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }),
});
// (c) profile FOR UPDATE (startAttempt lock): .from().where().limit().for() -> Promise<rows>.
const lockChain = () => ({ from: () => ({ where: () => ({ limit: () => ({ for: () => Promise.resolve([]) }) }) }) });
// (d) existing/existingUnderLock in_progress lookup: .from().where().orderBy().limit() -> Promise<rows>.
const orderLimitChain = (rows: unknown[]) => ({
  from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }) }),
});

beforeEach(() => {
  select.mockReset();
  redirectFn.mockClear();
});

describe("enforceAccess", () => {
  it("published-тест + достаточный tier -> доступ, без redirect и без запросов к БД", async () => {
    await expect(
      enforceAccess("u1", "premium", "premium", "full_reading", "item1", "mock", false),
    ).resolves.toBeUndefined();
    expect(redirectFn).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("tier ниже required, не-trial (одиночный пассаж) -> redirect на /app/upgrade", async () => {
    // passage_1 не входит в FULL_CATEGORIES -> trial-лейн неприменим, БД не читаем.
    await expect(
      enforceAccess("u1", "basic", "premium", "passage_1", "item1", null, false),
    ).rejects.toThrow("REDIRECT:/app/upgrade");
    expect(redirectFn).toHaveBeenCalledWith("/app/upgrade");
    expect(select).not.toHaveBeenCalled();
  });

  // Owner decision 2026-07-17: R/L контент бесплатен для всех тиров — 25/день mock-
  // only кап заменён на 2 practice/день + 2 mock/неделю, суммарно по R+L.
  it("Basic mock weekly-cap исчерпан -> redirect на /app/practice?limit=mock", async () => {
    // meetsTier(basic,basic) истинно -> ветка (a) пропущена целиком, читаем только кап.
    select.mockReturnValueOnce(whereChain([{ n: 2 }]));
    await expect(
      enforceAccess("u1", "basic", "basic", "full_reading", "item1", "mock", false),
    ).rejects.toThrow("REDIRECT:/app/practice?limit=mock");
    expect(redirectFn).toHaveBeenCalledWith("/app/practice?limit=mock");
  });

  it("Basic practice daily-cap исчерпан -> redirect на /app/practice?limit=practice", async () => {
    select.mockReturnValueOnce(whereChain([{ n: 2 }]));
    await expect(
      enforceAccess("u1", "basic", "basic", "part_1", "item1", "practice", false),
    ).rejects.toThrow("REDIRECT:/app/practice?limit=practice");
    expect(redirectFn).toHaveBeenCalledWith("/app/practice?limit=practice");
  });

  it("Basic practice: 1-й и 2-й старт проходят (n=0, n=1 < лимита 2), 3-й режется (n=2)", async () => {
    select.mockReturnValueOnce(whereChain([{ n: 0 }]));
    await expect(
      enforceAccess("u1", "basic", "basic", "part_1", "item1", "practice", false),
    ).resolves.toBeUndefined();

    select.mockReturnValueOnce(whereChain([{ n: 1 }]));
    await expect(
      enforceAccess("u1", "basic", "basic", "part_1", "item1", "practice", false),
    ).resolves.toBeUndefined();

    select.mockReturnValueOnce(whereChain([{ n: 2 }]));
    await expect(
      enforceAccess("u1", "basic", "basic", "part_1", "item1", "practice", false),
    ).rejects.toThrow("REDIRECT:/app/practice?limit=practice");
  });

  it("Basic mock: 1-й и 2-й старт за неделю проходят, 3-й режется", async () => {
    select.mockReturnValueOnce(whereChain([{ n: 0 }]));
    await expect(
      enforceAccess("u1", "basic", "basic", "full_listening", "item1", "mock", false),
    ).resolves.toBeUndefined();

    select.mockReturnValueOnce(whereChain([{ n: 1 }]));
    await expect(
      enforceAccess("u1", "basic", "basic", "full_listening", "item1", "mock", false),
    ).resolves.toBeUndefined();

    select.mockReturnValueOnce(whereChain([{ n: 2 }]));
    await expect(
      enforceAccess("u1", "basic", "basic", "full_listening", "item1", "mock", false),
    ).rejects.toThrow("REDIRECT:/app/practice?limit=mock");
  });

  it("Premium/Ultra не капается ни на practice, ни на mock — ветка (b) вообще не читает БД", async () => {
    await expect(
      enforceAccess("u1", "premium", "basic", "part_1", "item1", "practice", false),
    ).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();

    await expect(
      enforceAccess("u1", "ultra", "basic", "full_listening", "item1", "mock", false),
    ).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it("резюм существующей попытки (mode=null) не расходует кап — ветка (b) не читает БД, даже для Basic", async () => {
    await expect(
      enforceAccess("u1", "basic", "basic", "full_reading", "item1", null, false),
    ).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
    expect(redirectFn).not.toHaveBeenCalled();
  });

  it("trial-лейн: Basic + full-mock + trial не израсходован -> доступ (mock-кап тоже пройден)", async () => {
    select
      .mockReturnValueOnce(trialChain([])) // hasConsumedTrial -> ничего не найдено -> не израсходован
      .mockReturnValueOnce(whereChain([{ n: 0 }])); // недельный mock-кап далеко не исчерпан
    await expect(
      enforceAccess("u1", "basic", "premium", "full_reading", "item1", "mock", false),
    ).resolves.toBeUndefined();
    expect(redirectFn).not.toHaveBeenCalled();
  });

  // Codex-ревью волны G: регрессия «hasConsumedTrial всегда false» дала бы бесконечные
  // бесплатные full-моки — потреблённый trial обязан приводить к deny, не только
  // не-потреблённый к allow.
  it("trial-лейн: Basic + full-mock + trial УЖЕ потреблён -> redirect на /app/upgrade", async () => {
    // hasConsumedTrial находит расход (попытка на другом/сданном full-тесте) -> deny.
    select.mockReturnValueOnce(trialChain([{ id: "a1" }]));
    await expect(
      enforceAccess("u1", "basic", "premium", "full_reading", "item1", "mock", false),
    ).rejects.toThrow("REDIRECT:/app/upgrade");
    expect(redirectFn).toHaveBeenCalledWith("/app/upgrade");
    // Дневной кап после deny не читается — redirect бросает до ветки (b).
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("adminDraftBypass=true -> пропуск СРАЗУ, без единого запроса к БД (черновик вне монетизации)", async () => {
    // Тир заведомо недостаточен (basic < ultra) и кап заведомо исчерпан был бы —
    // bypass обязан отсечь ОБЕ проверки до первого select.
    await expect(
      enforceAccess("u1", "basic", "ultra", "full_reading", "item1", "mock", true),
    ).resolves.toBeUndefined();
    expect(redirectFn).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
});

describe("loadAccessData", () => {
  const profileRow = (role: string) => ({ tier: "basic", premiumUntil: null, role });
  const itemRow = (status: string) => ({
    tierRequired: "basic",
    category: "passage_1",
    bandScale: null,
    status,
  });

  it("draft + НЕ-админ -> null (страница-вызывающий сама редиректит на not-found путь)", async () => {
    select
      .mockReturnValueOnce(whereChain([profileRow("student")]))
      .mockReturnValueOnce(whereChain([itemRow("draft")]));
    const res = await loadAccessData("u1", "item1");
    expect(res).toBeNull();
  });

  it("draft + админ -> доступ с adminDraftBypass=true (F4 'Sit as student')", async () => {
    select
      .mockReturnValueOnce(whereChain([profileRow("admin")]))
      .mockReturnValueOnce(whereChain([itemRow("draft")]));
    const res = await loadAccessData("u1", "item1");
    expect(res).not.toBeNull();
    expect(res?.adminDraftBypass).toBe(true);
  });

  it("published + админ -> adminDraftBypass=false (байпас только для НЕОПУБЛИКОВАННОГО)", async () => {
    select
      .mockReturnValueOnce(whereChain([profileRow("admin")]))
      .mockReturnValueOnce(whereChain([itemRow("published")]));
    const res = await loadAccessData("u1", "item1");
    expect(res?.adminDraftBypass).toBe(false);
  });
});

describe("dayStartUtc / weekStartUtc (Codex review 2026-07-17, минор #6)", () => {
  it("dayStartUtc: середина дня -> полночь ТОГО ЖЕ UTC-дня", () => {
    expect(dayStartUtc(new Date("2026-07-16T15:00:00.000Z")).toISOString()).toBe(
      "2026-07-16T00:00:00.000Z",
    );
  });

  it("dayStartUtc: 23:59:59.999 UTC -> полночь ТОГО ЖЕ дня, не следующего", () => {
    expect(dayStartUtc(new Date("2026-07-19T23:59:59.999Z")).toISOString()).toBe(
      "2026-07-19T00:00:00.000Z",
    );
  });

  it("weekStartUtc: понедельник 00:00:00.000 UTC ровно -> сам себе начало недели", () => {
    // 2026-07-13 — понедельник (проверено node -e getUTCDay()).
    expect(weekStartUtc(new Date("2026-07-13T00:00:00.000Z")).toISOString()).toBe(
      "2026-07-13T00:00:00.000Z",
    );
  });

  it("weekStartUtc: середина недели (четверг) -> понедельник ТОЙ ЖЕ недели", () => {
    expect(weekStartUtc(new Date("2026-07-16T15:00:00.000Z")).toISOString()).toBe(
      "2026-07-13T00:00:00.000Z",
    );
  });

  it("weekStartUtc: воскресенье 23:59:59.999 UTC (последний миг недели) -> понедельник ТОЙ ЖЕ недели", () => {
    // 2026-07-19 — воскресенье, последний день недели, начавшейся в понедельник 07-13.
    expect(weekStartUtc(new Date("2026-07-19T23:59:59.999Z")).toISOString()).toBe(
      "2026-07-13T00:00:00.000Z",
    );
  });

  it("граница недели: воскресенье 23:59:59.999 -> понедельник 00:00:00.000 UTC — weekStartUtc прыгает на +7 дней", () => {
    // Ровно тот сценарий, который просил Codex-ревью: соседние миллисекунды по
    // разные стороны полуночи понедельника обязаны давать РАЗНЫЕ окна недели.
    const sunday = weekStartUtc(new Date("2026-07-19T23:59:59.999Z"));
    const monday = weekStartUtc(new Date("2026-07-20T00:00:00.000Z"));
    expect(sunday.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(monday.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    expect(monday.getTime() - sunday.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("startAttempt — resume-under-lock (Codex review 2026-07-17, минор #3)", () => {
  // Это ЧИСТОЕ ветвление (что startAttempt делает, если existingUnderLock уже
  // нашёлся), не проверка самой сериализации/лока — та часть остаётся
  // непокрытой юнитом, см. комментарий ниже. db.transaction здесь мокается тем
  // же приёмом, что persist.test.ts (tx делит select-очередь с db.select).
  it("Basic + needsCapCheck: existingUnderLock найден -> резюм БЕЗ cap-COUNT и БЕЗ redirect", async () => {
    select
      .mockReturnValueOnce(lockChain()) // profile FOR UPDATE — первым действием в tx
      .mockReturnValueOnce(
        orderLimitChain([{ id: "att-under-lock", answers: { q1: "x" }, mode: "practice" }]),
      ); // existingUnderLock — найден, конкурент уже открыл этот же item
    const result = await startAttempt("u1", "item1", "practice", false, null, "basic");
    expect(result).toEqual({ attemptId: "att-under-lock", answers: { q1: "x" }, mode: "practice" });
    // Ровно 2 select — cap-COUNT (был бы третьим) никогда не выполняется:
    // резюм отсекает и trialClaim-блок, и cap-check блок целиком.
    expect(select).toHaveBeenCalledTimes(2);
    expect(redirectFn).not.toHaveBeenCalled();
  });
});

// Не покрыто юнит-тестом (см. отчёт волны G): реальная гонка trial_claim под
// db.transaction (startAttempt isTrial-ветка) — требует настоящей БД/advisory-семантики
// PK-конфликта, хрупкий мок дал бы ложную уверенность без проверки реальной гонки.
//
// То же самое (Codex-ревью 2026-07-17, blocker) — АВТОРИТЕТНАЯ транзакционная
// проверка Basic-капа внутри startAttempt (SELECT ... FOR UPDATE на profile +
// COUNT в той же tx): мок db.transaction() тут дал бы ложную уверенность, что
// сериализация работает, ничего реально не заблокировав. Границы окна
// (dayStartUtc/weekStartUtc) покрыты юнит-тестами выше, а ветвление «резюм под
// локом vs. cap-COUNT» — тестом startAttempt выше (минор #3); это единственные
// чистые части логики, вынесенные/тестируемые именно ради этого без БД. Сам
// row-lock (реально ли БЛОКИРУЕТ конкурента, а не просто вызывается) проверен
// чтением apply-post-submit.ts (тот же паттерн, уже в проде) и остаётся
// непокрытым юнитом до отдельного интеграционного прогона на реальной БД (как
// для trial_claim выше).
