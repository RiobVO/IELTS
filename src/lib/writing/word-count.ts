import { MIN_WORDS, MAX_WORDS } from "./lifecycle";

// Word-count ring geometry (design handoff). A 62px SVG circle, r=44, stroke 9;
// the progress arc reads full at REF words and is bounded [0,1].
export const RING_R = 44;
export const RING_STROKE = 9;
export const RING_CIRC = 2 * Math.PI * RING_R;
const REF = 250; // default target length at which the ring reads full (Task 2)

/** Whitespace-split token count, mirroring validateEssay on the server. 0 for blank. */
export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export interface WordCountState {
  message: string;
  color: string;
  canSubmit: boolean;
  pct: number;
  offset: number;
}

/**
 * UI state for the live word-count ring: status message, accent colour (token,
 * not hex), whether submit is allowed, and the SVG fill (pct + strokeDashoffset).
 * Submit bounds match the server gate (MIN_WORDS..MAX_WORDS); the ring fills toward
 * `ref` so the essay reads full at its part's minimum (250 for Task 2, 150 for Task 1).
 */
export function wordCountState(n: number, ref: number = REF): WordCountState {
  const pct = Math.max(0, Math.min(1, n / ref));
  const offset = RING_CIRC * (1 - pct);
  if (n === 0) return { message: "Start writing", color: "var(--text-muted)", canSubmit: false, pct, offset };
  if (n < MIN_WORDS)
    return { message: `${MIN_WORDS - n} more to reach the minimum`, color: "var(--text-muted)", canSubmit: false, pct, offset };
  if (n > MAX_WORDS)
    return { message: `${n - MAX_WORDS} over the maximum — trim to submit`, color: "var(--error-text)", canSubmit: false, pct, offset };
  return { message: "Ready to submit", color: "var(--success-text)", canSubmit: true, pct, offset };
}
