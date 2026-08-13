import { describe, it, expect } from "vitest";
import { buildDigestEmail, type DigestStats } from "./digest-template";
import type { BandPlan } from "@/lib/progress/band-plan";

const BASE: DigestStats = {
  testsCount: 3,
  avgBand: null,
  avgPercent: null,
  rating: 1500,
  ratingDelta: null,
  weekStart: "2026-06-30",
  weekEnd: "2026-07-06",
  unsubscribeUrl: null,
};

const SAMPLE_PLAN: BandPlan = {
  currentBand: 6,
  targetBand: 7,
  distance: 1,
  reached: false,
  weakTypes: [
    { qtype: "true_false_ng", label: "True/False/Not Given", section: "reading", correct: 3, total: 10, pct: 30 },
  ],
  drill: {
    qtype: "true_false_ng",
    label: "True/False/Not Given",
    section: "reading",
    estMinutes: 15,
    bandGain: 0.5,
  },
};

describe("buildDigestEmail", () => {
  it("subject содержит число тестов", () => {
    const { subject } = buildDigestEmail({ ...BASE, testsCount: 5 });
    expect(subject).toBe("Your IELTS week: 5 tests");
  });

  it("avgBand != null → строка Average band X.X", () => {
    const { html } = buildDigestEmail({ ...BASE, avgBand: 6.75 });
    expect(html).toContain("Average band 6.8");
  });

  it("avgBand == null → строки Average band нет", () => {
    const { html } = buildDigestEmail({ ...BASE, avgBand: null });
    expect(html).not.toContain("Average band");
  });

  it("avgPercent != null → строка Average score N%", () => {
    const { html } = buildDigestEmail({ ...BASE, avgPercent: 72.4 });
    expect(html).toContain("Average score 72%");
  });

  it("avgPercent == null → строки Average score нет", () => {
    const { html } = buildDigestEmail({ ...BASE, avgPercent: null });
    expect(html).not.toContain("Average score");
  });

  it("ratingDelta положительный → явный знак +", () => {
    const { html } = buildDigestEmail({ ...BASE, rating: 1550, ratingDelta: 50 });
    expect(html).toContain("Rating: 1550 (+50)");
  });

  it("ratingDelta отрицательный → явный знак -", () => {
    const { html } = buildDigestEmail({ ...BASE, rating: 1450, ratingDelta: -30 });
    expect(html).toContain("Rating: 1450 (-30)");
  });

  it("ratingDelta == null (первая неделя) → без скобок", () => {
    const { html } = buildDigestEmail({ ...BASE, rating: 1500, ratingDelta: null });
    expect(html).toContain("Rating: 1500");
    expect(html).not.toContain("Rating: 1500 (");
  });

  it("unsubscribeUrl != null → есть ссылка Unsubscribe", () => {
    const { html } = buildDigestEmail({
      ...BASE,
      unsubscribeUrl: "https://example.com/unsubscribe?u=abc&t=def",
    });
    expect(html).toContain("Unsubscribe");
    expect(html).toContain('href="https://example.com/unsubscribe?u=abc&amp;t=def"');
  });

  it("unsubscribeUrl == null → ссылки Unsubscribe нет", () => {
    const { html } = buildDigestEmail({ ...BASE, unsubscribeUrl: null });
    expect(html).not.toContain("Unsubscribe");
  });

  it("амперсанд в unsubscribeUrl экранирован (не голый &)", () => {
    const { html } = buildDigestEmail({
      ...BASE,
      unsubscribeUrl: "https://example.com/u?a=1&b=2",
    });
    expect(html).not.toContain('href="https://example.com/u?a=1&b=2"');
    expect(html).toContain('href="https://example.com/u?a=1&amp;b=2"');
  });

  it("диапазон дат недели человекочитаемый (UTC)", () => {
    const { html } = buildDigestEmail(BASE);
    expect(html).toContain("Jun 30 – Jul 6, 2026");
  });

  it("одна тестовая совместимость с множественным числом (1 test)", () => {
    const { html } = buildDigestEmail({ ...BASE, testsCount: 1 });
    expect(html).toContain("<strong>1</strong> test completed this week");
  });

  it("bandPlan с targetBand → секция плана с дистанцией и лейблом дрилла", () => {
    const { html } = buildDigestEmail({
      ...BASE,
      bandPlan: SAMPLE_PLAN,
      practiceUrl: "https://example.com/app/practice",
    });
    expect(html).toContain("Your plan to band 7");
    expect(html).toContain("1 away");
    expect(html).toContain("Weakest area: True/False/Not Given");
    expect(html).toContain("This week's drill: True/False/Not Given (~15 min, +0.5 band)");
    expect(html).toContain('href="https://example.com/app/practice"');
  });

  it("bandPlan.reached → «Target reached» вместо дистанции", () => {
    const { html } = buildDigestEmail({
      ...BASE,
      bandPlan: { ...SAMPLE_PLAN, reached: true, distance: 0 },
      practiceUrl: null,
    });
    expect(html).toContain("Target reached");
    expect(html).not.toContain("0 away");
  });

  it("bandPlan не передан → секции плана нет", () => {
    const { html } = buildDigestEmail(BASE);
    expect(html).not.toContain("Your plan to band");
  });

  it("bandPlan.targetBand == null → секция плана опускается", () => {
    const { html } = buildDigestEmail({
      ...BASE,
      bandPlan: { ...SAMPLE_PLAN, targetBand: null, distance: null, reached: false },
    });
    expect(html).not.toContain("Your plan to band");
  });

  it("label в weakTypes/drill экранируется (защита от инъекции разметки)", () => {
    const evilPlan: BandPlan = {
      ...SAMPLE_PLAN,
      weakTypes: [{ ...SAMPLE_PLAN.weakTypes[0], label: "<script>alert(1)</script>" }],
      drill: { ...SAMPLE_PLAN.drill!, label: "<script>alert(1)</script>" },
    };
    const { html } = buildDigestEmail({ ...BASE, bandPlan: evilPlan });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
