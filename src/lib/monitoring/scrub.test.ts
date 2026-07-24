// Юнит-тесты приватного фильтра Sentry-событий (срез query/PII из URL).
import { describe, it, expect } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubEvent } from "./scrub";

// Минимальное событие — scrubEvent трогает только request.url / query_string.
const makeEvent = (request: unknown): ErrorEvent =>
  ({ request }) as unknown as ErrorEvent;

describe("scrubEvent", () => {
  it("срезает query-строку из request.url (?ref/?code/токены не утекают)", () => {
    const e = scrubEvent(
      makeEvent({ url: "https://app.test/auth?ref=SECRET&code=XYZ" }),
    );
    expect(e.request?.url).toBe("https://app.test/auth");
    expect(e.request?.url).not.toContain("SECRET");
  });

  it("удаляет отдельное поле query_string", () => {
    const e = scrubEvent(
      makeEvent({ url: "https://app.test/x", query_string: "ref=SECRET" }),
    );
    expect(e.request?.query_string).toBeUndefined();
  });

  it("URL без query-строки не трогает", () => {
    const e = scrubEvent(makeEvent({ url: "https://app.test/app/reading" }));
    expect(e.request?.url).toBe("https://app.test/app/reading");
  });

  it("без request — no-op, не падает", () => {
    const e = scrubEvent({} as ErrorEvent);
    expect(e).toEqual({});
  });
});
