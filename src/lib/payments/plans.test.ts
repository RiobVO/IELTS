// Юнит-тесты каталога тарифов (BRIEF §4.8). Контракт: поиск по паре (tier, months).
// Сумму НЕ проверяем — это плейсхолдер-данные, а не поведение функции.
import { describe, it, expect } from "vitest";
import { findPlan } from "./plans";

describe("findPlan", () => {
  it("возвращает тариф, совпадающий и по tier, и по months", () => {
    const premiumMonthly = findPlan("premium", 1);
    expect(premiumMonthly).toBeDefined();
    expect(premiumMonthly?.tier).toBe("premium");
    expect(premiumMonthly?.months).toBe(1);
    expect(premiumMonthly?.currency).toBe("UZS");

    const ultraAnnual = findPlan("ultra", 12);
    expect(ultraAnnual?.tier).toBe("ultra");
    expect(ultraAnnual?.months).toBe(12);
  });

  it("различает тарифы одного tier по months (не матчит только по tier)", () => {
    expect(findPlan("premium", 1)?.months).toBe(1);
    expect(findPlan("premium", 12)?.months).toBe(12);
  });

  it("возвращает undefined для комбинации не из каталога", () => {
    expect(findPlan("premium", 3)).toBeUndefined();
    expect(findPlan("ultra", 6)).toBeUndefined();
    expect(findPlan("basic", 1)).toBeUndefined(); // basic не покупается
    expect(findPlan("", 0)).toBeUndefined();
  });
});
