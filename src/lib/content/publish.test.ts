import { describe, it, expect, vi, beforeEach } from "vitest";

// publish.ts pulls @/db (env-validating at import) + next/cache; mock both so the gate
// logic runs in isolation. The answer-key review gate (reviewed_at, BRIEF §4.2.1) must
// hold on EVERY publish path — this helper is the single chokepoint both callers share.
const { select, update } = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }));
const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a), update: (...a: unknown[]) => update(...a) } }));
vi.mock("next/cache", () => ({ revalidateTag }));
import { publishReviewedContentItem } from "./publish";

const selectChain = (rows: unknown[]) => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) });
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

  it("publishes a reviewed item and returns its title", async () => {
    select.mockReturnValue(selectChain([{ reviewedAt: new Date(), title: "Reading 1" }]));
    update.mockReturnValue(updateChain());
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: true, title: "Reading 1" });
    expect(update).toHaveBeenCalledOnce();
    expect(revalidateTag).toHaveBeenCalledWith("content_item");
  });
});
