// Письмо возврата (G2-4) уходит людям, которые уже однажды перестали заходить —
// цена неудачного тона здесь не «не открыли», а отписка. Тесты пиннят обещания
// копирайта: не винить, не выдумывать несуществующий стрик, не звать в пустой каталог.
import { describe, it, expect } from "vitest";
import {
  buildReactivationEmail,
  reactivationSubject,
  type ReactivationEmailInput,
} from "./reactivation-template";

function mk(overrides: Partial<ReactivationEmailInput> = {}): ReactivationEmailInput {
  return {
    daysSilent: 7,
    newTestsThisWeek: 2,
    lastStreak: 4,
    practiceUrl: "https://bando.study/app/practice?src=reactivation",
    unsubscribeUrl: "https://bando.study/api/email/unsubscribe?u=1&t=abc",
    ...overrides,
  };
}

describe("reactivationSubject", () => {
  it("новинки есть → тема обещает их, с правильным числом", () => {
    expect(reactivationSubject(mk({ newTestsThisWeek: 3 }))).toBe(
      "3 new IELTS tests are waiting for you",
    );
    expect(reactivationSubject(mk({ newTestsThisWeek: 1 }))).toBe(
      "A new IELTS test is waiting for you",
    );
  });

  it("новинок нет → тема не врёт про них", () => {
    const subject = reactivationSubject(mk({ newTestsThisWeek: 0 }));
    expect(subject).not.toMatch(/new/i);
  });

  it("две недели тишины звучат иначе, чем одна", () => {
    const week = reactivationSubject(mk({ newTestsThisWeek: 0, daysSilent: 7 }));
    const fortnight = reactivationSubject(mk({ newTestsThisWeek: 0, daysSilent: 14 }));
    expect(week).not.toBe(fortnight);
  });
});

describe("buildReactivationEmail", () => {
  it("упоминает стрик, только если он был", () => {
    expect(buildReactivationEmail(mk({ lastStreak: 5 })).html).toContain("5-day streak");
    const noStreak = buildReactivationEmail(mk({ lastStreak: 0 })).html;
    expect(noStreak).not.toMatch(/streak/);
  });

  it("число новинок попадает в тело письма, при нуле блока нет", () => {
    expect(buildReactivationEmail(mk({ newTestsThisWeek: 4 })).html).toContain("<strong>4</strong>");
    expect(buildReactivationEmail(mk({ newTestsThisWeek: 0 })).html).not.toMatch(
      /new test.{0,20}published/,
    );
  });

  it("без ссылок (нет origin) письмо всё равно собирается — без кнопки и отписки", () => {
    const html = buildReactivationEmail(mk({ practiceUrl: null, unsubscribeUrl: null })).html;
    expect(html).not.toContain("Practice now");
    expect(html).not.toContain("Unsubscribe");
    expect(html).toContain("<html>");
  });

  it("ссылка отписки и CTA рендерятся с экранированием кавычек", () => {
    const html = buildReactivationEmail(
      mk({ practiceUrl: 'https://x.test/a?b="c"', unsubscribeUrl: "https://x.test/u?t=1&z=2" }),
    ).html;
    expect(html).toContain("&quot;c&quot;");
    expect(html).toContain("t=1&amp;z=2");
  });
});
