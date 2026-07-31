// Pure view-logic for the feedback screen: band axis geometry, target gap,
// confidence meter, and the deterministic weakest-first / blocker derivation.
// The blocker is COMPUTED (lowest band midpoint), not a model-supplied field.

export interface CriterionLike {
  name: string;
  bandLow: number;
  bandHigh: number;
  strength: string;
  mainIssue: string;
  nextStep: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export const midpoint = (c: { bandLow: number; bandHigh: number }) => (c.bandLow + c.bandHigh) / 2;

/** 4.0–9.0 axis → 0–100%, clamped to the rail. */
export function axisPct(band: number): number {
  return Math.max(0, Math.min(100, ((band - 4) / 5) * 100));
}

/** "+X to T.0" while below target, "at target" once the high end reaches it. */
export function gapToTarget(high: number, target: number): string {
  const to = round1(target - high);
  return to > 0 ? `+${to} to ${target.toFixed(1)}` : "at target";
}

export function confidencePills(level: "low" | "medium" | "high"): number {
  return level === "low" ? 1 : level === "medium" ? 2 : 3;
}

/** New array, ascending by midpoint; JS sort is stable so ties keep input order. */
export function sortWeakestFirst<T extends { bandLow: number; bandHigh: number }>(criteria: T[]): T[] {
  return [...criteria].sort((a, b) => midpoint(a) - midpoint(b));
}

/** Index (in the ORIGINAL array) of the blocker = lowest midpoint, first on tie. */
export function blockerIndex(criteria: { bandLow: number; bandHigh: number }[]): number {
  let best = 0;
  for (let i = 1; i < criteria.length; i++) {
    if (midpoint(criteria[i]) < midpoint(criteria[best])) best = i;
  }
  return best;
}

export interface AnnoSegment {
  text: string;
  annIndex: number | null;
}

/**
 * Split the essay into segments, wrapping each annotation quote (located as a
 * first-match substring) so the UI can render <mark> highlights. Quotes are
 * applied in document order, greedily non-overlapping; a quote not found (or
 * overlapping an earlier one) is skipped — its comment card still renders, just
 * without a highlight. `annIndex` points back into the original quotes array.
 */
export function buildAnnotationSegments(essay: string, quotes: string[]): AnnoSegment[] {
  const hits = quotes
    .map((q, i) => ({ i, idx: q ? essay.indexOf(q) : -1, len: q.length }))
    .filter((h) => h.idx >= 0 && h.len > 0)
    .sort((a, b) => a.idx - b.idx);

  const segments: AnnoSegment[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.idx < cursor) continue; // overlaps an earlier highlight — skip
    if (h.idx > cursor) segments.push({ text: essay.slice(cursor, h.idx), annIndex: null });
    segments.push({ text: essay.slice(h.idx, h.idx + h.len), annIndex: h.i });
    cursor = h.idx + h.len;
  }
  if (cursor < essay.length) segments.push({ text: essay.slice(cursor), annIndex: null });
  return segments;
}
