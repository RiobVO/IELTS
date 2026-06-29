import { describe, it, expect } from "vitest";
import { alignTranscriptTimings, type WhisperWord } from "./transcript-align";

// Whisper word stream for "Hello world. I am fine." — accurate, monotonic timings.
const words: WhisperWord[] = [
  { word: "Hello", start: 0, end: 0.4 },
  { word: "world", start: 0.4, end: 0.8 },
  { word: "I", start: 1.2, end: 1.3 },
  { word: "am", start: 1.3, end: 1.5 },
  { word: "fine", start: 1.6, end: 1.9 },
];

describe("alignTranscriptTimings", () => {
  it("anchors each sentence to the start of its first matched Whisper word", () => {
    const out = alignTranscriptTimings("Hello world. I am fine.", words, 2.0);
    expect(out).toEqual([
      { text: "Hello world.", startSec: 0 },
      { text: " I am fine.", startSec: 1.2 },
    ]);
  });

  it("keeps the verbatim sentence text (errors/fillers intact, not Whisper's cleaned text)", () => {
    // Gemini transcript keeps the candidate's slip "common language"; Whisper 'cleans' it
    // to "languages" — alignment must show the candidate's words, only borrow the timing.
    const w: WhisperWord[] = [
      { word: "I", start: 0, end: 0.2 },
      { word: "use", start: 0.2, end: 0.5 },
      { word: "common", start: 0.6, end: 0.9 },
      { word: "languages", start: 0.9, end: 1.3 },
    ];
    const out = alignTranscriptTimings("I use common language.", w, 1.5);
    expect(out[0].text).toBe("I use common language.");
    expect(out[0].startSec).toBe(0);
  });

  it("returns [] for an empty or whitespace-only transcript", () => {
    expect(alignTranscriptTimings("", words, 2)).toEqual([]);
    expect(alignTranscriptTimings("   ", words, 2)).toEqual([]);
  });

  it("returns [] when there are no Whisper words to anchor on", () => {
    expect(alignTranscriptTimings("Hello world.", [], 2)).toEqual([]);
  });

  it("clamps timings monotonically non-decreasing even if Whisper times dip", () => {
    const dip: WhisperWord[] = [
      { word: "A", start: 1.0, end: 1.1 },
      { word: "B", start: 0.5, end: 0.6 },
    ];
    const out = alignTranscriptTimings("A. B.", dip, 2);
    expect(out[0].startSec).toBe(1.0);
    expect(out[1].startSec).toBe(1.0); // clamped up to the previous start, never goes back
  });

  it("falls back to positional proportion when a sentence's first word isn't found", () => {
    const w: WhisperWord[] = [
      { word: "Hello", start: 0, end: 0.4 },
      { word: "world", start: 0.4, end: 0.8 },
    ];
    // 2nd sentence ("Xyz qrs") has no Whisper match → proportion: wordIndex 2 / 4 total * 1.6s
    const out = alignTranscriptTimings("Hello world. Xyz qrs.", w, 1.6);
    expect(out[0].startSec).toBe(0);
    expect(out[1].startSec).toBeCloseTo(0.8, 5);
  });

  it("clamps a timing that overshoots the audio duration", () => {
    const w: WhisperWord[] = [{ word: "A", start: 5.0, end: 5.1 }];
    const out = alignTranscriptTimings("A.", w, 2.0);
    expect(out[0].startSec).toBe(2.0);
  });
});
