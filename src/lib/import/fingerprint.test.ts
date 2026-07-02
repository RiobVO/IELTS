import { describe, it, expect } from "vitest";
import { testFingerprint } from "./fingerprint";

// Дубль-гвард (QA 2026-07-02): тот же тест под другим именем файла ложился второй
// строкой. Отпечаток — по содержимому ключа ответов: имя файла/титул подделать
// легко, 40 ответов — нет.
describe("testFingerprint", () => {
  const base = [
    { number: 1, accept: ["raindrops", "raindrop"] },
    { number: 2, accept: ["TRUE"] },
    { number: 3, accept: ["1985"] },
  ];

  it("не зависит от порядка вопросов и вариантов, и от регистра", () => {
    const shuffled = [
      { number: 3, accept: ["1985"] },
      { number: 1, accept: ["Raindrop", "RAINDROPS"] },
      { number: 2, accept: ["true"] },
    ];
    expect(testFingerprint(shuffled)).toBe(testFingerprint(base));
  });

  it("другой ответ — другой отпечаток", () => {
    const other = [...base.slice(0, 2), { number: 3, accept: ["1986"] }];
    expect(testFingerprint(other)).not.toBe(testFingerprint(base));
  });

  it("другой номер вопроса — другой отпечаток", () => {
    const other = [base[0]!, base[1]!, { number: 4, accept: ["1985"] }];
    expect(testFingerprint(other)).not.toBe(testFingerprint(base));
  });
});
