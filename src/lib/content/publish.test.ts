import { describe, it, expect, vi, beforeEach } from "vitest";

// publish.ts pulls @/db (env-validating at import) + next/cache; mock both so the gate
// logic runs in isolation. The answer-key review gate (reviewed_at, BRIEF §4.2.1) must
// hold on EVERY publish path — this helper is the single chokepoint both callers share.
const { select, update } = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }));
const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a), update: (...a: unknown[]) => update(...a) } }));
vi.mock("next/cache", () => ({ revalidateTag }));
import { publishReviewedContentItem } from "./publish";

// select #1 (content item): .from().where().limit(); select #2 (#17 answer-key gate):
// .from().innerJoin().where().
const selectChain = (rows: unknown[]) => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) });
const keysChain = (rows: unknown[]) => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(rows) }) }) });
const updateChain = () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) });

beforeEach(() => {
  select.mockReset();
  update.mockReset();
  revalidateTag.mockReset();
});

describe("publishReviewedContentItem", () => {
  it("refuses to publish an unreviewed item (reviewed_at null) without an update", async () => {
    select.mockReturnValue(selectChain([{ reviewedAt: null, title: "T" }]));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "not_reviewed" });
    expect(update).not.toHaveBeenCalled();
  });

  it("reports not_found for a missing item", async () => {
    select.mockReturnValue(selectChain([]));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "not_found" });
    expect(update).not.toHaveBeenCalled();
  });

  it("publishes a reviewed item with non-empty keys and returns its title", async () => {
    select
      .mockReturnValueOnce(selectChain([{ reviewedAt: new Date(), title: "Reading 1" }]))
      .mockReturnValueOnce(keysChain([{ accept: ["A"] }, { accept: ["journal", "journals"] }]));
    update.mockReturnValue(updateChain());
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: true, title: "Reading 1" });
    expect(update).toHaveBeenCalledOnce();
    expect(revalidateTag).toHaveBeenCalledWith("content_item");
  });

  it("refuses to publish when any question has an empty answer key (#17)", async () => {
    select
      .mockReturnValueOnce(selectChain([{ reviewedAt: new Date(), title: "Reading 1" }]))
      .mockReturnValueOnce(keysChain([{ accept: ["A"] }, { accept: [""] }])); // one blank key
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "empty_answer_key" });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses to publish when a question type didn't resolve (unknown-type fallback) (#13)", async () => {
    // qtype in the DB is already 'short_answer' (fallback applied), so the only durable
    // trace of the unresolved type is the persisted import warning — the gate reads it back.
    select.mockReturnValueOnce(
      selectChain([
        {
          reviewedAt: new Date(),
          title: "Reading 1",
          importWarnings: ['Q2: unknown type "Frobnicate" → fell back to short_answer'],
        },
      ]),
    );
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "unresolved_question_type" });
    expect(update).not.toHaveBeenCalled();
  });

  it("publishes despite informational / low-confidence warnings — only unknown-type blocks (#13)", async () => {
    // Guard against a false barrier: most real imports carry low-confidence / no-explanation
    // warnings; those must NOT block publishing (the type is resolved, grading is fine).
    select
      .mockReturnValueOnce(
        selectChain([
          {
            reviewedAt: new Date(),
            title: "Reading 1",
            importWarnings: [
              'Q3: low-confidence type "Some Matching" → matching_info',
              "2 question(s) without explanation",
            ],
          },
        ]),
      )
      .mockReturnValueOnce(keysChain([{ accept: ["A"] }]));
    update.mockReturnValue(updateChain());
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: true, title: "Reading 1" });
    expect(update).toHaveBeenCalledOnce();
  });
});
