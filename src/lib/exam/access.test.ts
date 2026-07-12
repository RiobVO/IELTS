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
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }));
vi.mock("next/navigation", () => ({ redirect: redirectFn }));
vi.mock("@/lib/analytics/server", () => ({ captureServer: vi.fn() }));

import { enforceAccess, loadAccessData } from "./access";

// (a) profile/count-запросы: .from().where() -> Promise<rows>.
const whereChain = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
// (b) hasConsumedTrial: .from().innerJoin().where().limit() -> Promise<rows>.
const trialChain = (rows: unknown[]) => ({
  from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }),
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

  it("Basic daily-cap исчерпан -> redirect на /app/practice?limit=1", async () => {
    // meetsTier(basic,basic) истинно -> ветка (a) пропущена целиком, читаем только кап.
    select.mockReturnValueOnce(whereChain([{ n: 25 }]));
    await expect(
      enforceAccess("u1", "basic", "basic", "full_reading", "item1", "mock", false),
    ).rejects.toThrow("REDIRECT:/app/practice?limit=1");
    expect(redirectFn).toHaveBeenCalledWith("/app/practice?limit=1");
  });

  it("trial-лейн: Basic + full-mock + trial не израсходован -> доступ (кап тоже пройден)", async () => {
    select
      .mockReturnValueOnce(trialChain([])) // hasConsumedTrial -> ничего не найдено -> не израсходован
      .mockReturnValueOnce(whereChain([{ n: 0 }])); // дневной кап далеко не исчерпан
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

// Не покрыто юнит-тестом (см. отчёт волны G): реальная гонка trial_claim под
// db.transaction (startAttempt isTrial-ветка) — требует настоящей БД/advisory-семантики
// PK-конфликта, хрупкий мок дал бы ложную уверенность без проверки реальной гонки.
