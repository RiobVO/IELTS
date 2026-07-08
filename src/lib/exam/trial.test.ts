// Юнит-тесты trial-лейна (§4.8): Basic получает ОДИН бесплатный полный tier-
// гейтнутый тест. Тестируем ЧИСТОЕ решение trialAllows — DB-часть (израсходован ли
// trial, с исключением текущего content_item) живёт в hasConsumedTrial и в этой
// модели передаётся параметром trialConsumed. npm test = чистая логика, без БД.
import { describe, it, expect } from "vitest";
import { isFullCategory, trialAllows, trialConsumedBy } from "./trial";

describe("isFullCategory", () => {
  it("только full_reading / full_listening — полные тесты", () => {
    expect(isFullCategory("full_reading")).toBe(true);
    expect(isFullCategory("full_listening")).toBe(true);
  });
  it("одиночные passage/part — НЕ полные", () => {
    expect(isFullCategory("passage_1")).toBe(false);
    expect(isFullCategory("part_2")).toBe(false);
    expect(isFullCategory("")).toBe(false);
  });
});

describe("trialAllows", () => {
  it("Basic + полный premium-тест, trial не израсходован → доступ (первый бесплатный)", () => {
    expect(
      trialAllows({
        userTier: "basic",
        tierRequired: "premium",
        category: "full_reading",
        trialConsumed: false,
      }),
    ).toBe(true);
  });

  it("Basic + полный premium-тест, есть submitted-попытка на ДРУГОМ полном → deny (trial израсходован)", () => {
    // hasConsumedTrial нашёл attempt на другом gated-full → trialConsumed=true.
    expect(
      trialAllows({
        userTier: "basic",
        tierRequired: "premium",
        category: "full_listening",
        trialConsumed: true,
      }),
    ).toBe(false);
  });

  it("Basic + in_progress ТОЛЬКО на этом же item → доступ (резюм/submit своего trial)", () => {
    // trialConsumedBy(этот item, in_progress) = false → собственный недосданный trial
    // не блокирует resume и submit.
    expect(
      trialAllows({
        userTier: "basic",
        tierRequired: "premium",
        category: "full_reading",
        trialConsumed: false,
      }),
    ).toBe(true);
  });

  it("Premium-юзер → обычный гейт (trial не применяется)", () => {
    // Доступный тест: meetsTier проходит независимо от trialConsumed.
    expect(
      trialAllows({
        userTier: "premium",
        tierRequired: "premium",
        category: "full_reading",
        trialConsumed: true,
      }),
    ).toBe(true);
    // Недоступный (ultra-тест): не-Basic не получает trial → обычный deny.
    expect(
      trialAllows({
        userTier: "premium",
        tierRequired: "ultra",
        category: "full_reading",
        trialConsumed: false,
      }),
    ).toBe(false);
  });

  it("Basic + одиночный premium passage → обычный deny (trial только для полных тестов)", () => {
    expect(
      trialAllows({
        userTier: "basic",
        tierRequired: "premium",
        category: "passage_1",
        trialConsumed: false,
      }),
    ).toBe(false);
  });

  it("Basic + полный тест с tier_required=basic → обычный allow (тест не гейтнут)", () => {
    expect(
      trialAllows({
        userTier: "basic",
        tierRequired: "basic",
        category: "full_reading",
        trialConsumed: true, // не важно: meetsTier уже пропускает
      }),
    ).toBe(true);
  });
});

describe("trialConsumedBy (C1: правило расхода относительно текущего item)", () => {
  const X = "item-x";
  const Y = "item-y";

  it("нет попыток → не израсходован", () => {
    expect(trialConsumedBy([], X)).toBe(false);
  });

  it("in_progress ТОЛЬКО на этом item → НЕ израсходован (резюм/submit живут)", () => {
    expect(trialConsumedBy([{ contentItemId: X, status: "in_progress" }], X)).toBe(false);
  });

  it("submitted на ЭТОМ ЖЕ item → израсходован (нет бесконечных бесплатных ретейков)", () => {
    expect(trialConsumedBy([{ contentItemId: X, status: "submitted" }], X)).toBe(true);
  });

  it("попытка на ДРУГОМ full (любой статус) → израсходован", () => {
    expect(trialConsumedBy([{ contentItemId: Y, status: "in_progress" }], X)).toBe(true);
    expect(trialConsumedBy([{ contentItemId: Y, status: "submitted" }], X)).toBe(true);
  });

  it("in_progress + submitted на этом item → израсходован (submitted перевешивает)", () => {
    expect(
      trialConsumedBy(
        [
          { contentItemId: X, status: "in_progress" },
          { contentItemId: X, status: "submitted" },
        ],
        X,
      ),
    ).toBe(true);
  });
});
