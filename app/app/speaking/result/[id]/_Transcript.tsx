"use client";

import type React from "react";
import { useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import { buildAnnotationSegments, type AnnoSegment } from "@/lib/writing/feedback-view";
import type { TranscriptTiming } from "@/lib/speaking/transcript-align";
import { deleteSpeakingRecording } from "../../actions";

/**
 * Annotated transcript (handoff §4) — the one Speaking-specific result surface (band
 * card + criteria reuse Writing). The verbatim transcript is rendered with inline
 * <mark> highlights per annotation, tinted by type AND given a distinct underline so
 * the marks read without relying on colour (a11y). A legend names each underline.
 *
 * Pauses carry no duration in our schema (annotations = {quote, comment, type}); per
 * the MVP decision they surface as notes (a ▍ chip), not inline marks — so they never
 * mis-wrap transcript words. Deleting the recording wipes audio + transcript server-side;
 * the block then shows the "removed" state while the band/feedback stay.
 */
export type SpeakType = "pause" | "filler" | "repair" | "grammar" | "good";
export interface SpeakAnno {
  quote: string;
  comment: string;
  type: SpeakType;
}

interface TypeStyle {
  tint: string;
  accent: string;
  deco: "dotted" | "double" | "wavy" | "solid";
  legend: string;
  decoName: string;
  def: string;
}

const TYPE_STYLE: Record<SpeakType, TypeStyle> = {
  pause: { tint: "var(--surface-inset)", accent: "var(--border-strong)", deco: "solid", legend: "Pause", decoName: "chip", def: "A noticeable silence — work on keeping the flow going." },
  filler: { tint: "color-mix(in oklab, var(--warn) 24%, transparent)", accent: "var(--warn-text)", deco: "dotted", legend: "Filler", decoName: "dotted", def: "Um, you know — words that fill a gap." },
  repair: { tint: "color-mix(in oklab, var(--streak) 22%, transparent)", accent: "var(--streak)", deco: "double", legend: "Self-repair", decoName: "double", def: "Restarting or correcting mid-sentence." },
  grammar: { tint: "color-mix(in oklab, var(--error) 16%, transparent)", accent: "var(--error-text)", deco: "wavy", legend: "Grammar", decoName: "wavy", def: "A grammar slip worth fixing." },
  good: { tint: "color-mix(in oklab, var(--success) 24%, transparent)", accent: "var(--success-text)", deco: "solid", legend: "Good move", decoName: "solid", def: "A strong word or structure — keep doing this." },
};

const LEGEND_ORDER: SpeakType[] = ["pause", "filler", "repair", "grammar", "good"];

// Static waveform: deterministic bar heights (sin-hash, not Math.random → stable across
// renders and SSR-safe). Purely decorative; the played split is driven by currentTime.
const WAVE_BARS = 52;
const BAR_HEIGHTS = Array.from({ length: WAVE_BARS }, (_, i) => {
  const seed = Math.sin(i * 12.9898) * 43758.5453;
  return 0.3 + (seed - Math.floor(seed)) * 0.7; // 0.3–1.0 of the track height
});

function fmtTime(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? sec : 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

const PLAY_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
);
const PAUSE_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

export function Transcript({
  submissionId,
  transcript,
  annotations,
  timings,
  audioUrl,
  removed: removedInitial,
}: {
  submissionId: string;
  transcript: string;
  annotations: SpeakAnno[];
  /** Sentence-level sync timings; non-empty + audio present → karaoke mode. */
  timings: TranscriptTiming[];
  /** Short-lived signed playback URL (null once audio is deleted). */
  audioUrl: string | null;
  removed: boolean;
}) {
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [activeSentence, setActiveSentence] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [deleted, setDeleted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const removed = removedInitial || deleted;

  async function del() {
    setBusy(true);
    const res = await deleteSpeakingRecording(submissionId);
    setBusy(false);
    if (res.ok) {
      setDeleted(true);
      setConfirming(false);
      router.refresh(); // sync the server snapshot (transcript now "")
    }
  }

  if (removed) {
    return (
      <section style={S.removedCard}>
        <span style={S.removedCircle} aria-hidden="true">
          <Icon name="trash" size={24} strokeWidth={2} style={{ color: "var(--error-text)" }} />
        </span>
        <h3 style={S.removedTitle}>Transcript removed</h3>
        <p style={S.removedBody}>
          You deleted this recording, so its audio and transcript are gone. Your band score and feedback stay in your history.
        </p>
        <Button variant="secondary" href="/app/speaking">Record a new attempt</Button>
      </section>
    );
  }

  // Inline-mark every non-pause annotation (pauses surface as notes only).
  const quotes = annotations.map((a) => (a.type === "pause" ? "" : a.quote));
  const segments = buildAnnotationSegments(transcript, quotes);
  const words = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;

  // Karaoke mode: accurate Whisper timings aligned onto the Gemini transcript, plus the
  // take still exists. Highlight the line the audio is on; click a line to jump there.
  const sync = audioUrl !== null && timings.length > 0;

  function onTimeUpdate() {
    const t = audioRef.current?.currentTime ?? 0;
    setCurrentTime(t);
    let found = -1;
    for (let i = 0; i < timings.length; i++) {
      if (timings[i].startSec <= t + 0.02) found = i;
      else break;
    }
    setActiveSentence((prev) => (prev === found ? prev : found));
  }

  function seekTo(i: number) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = timings[i].startSec;
    void a.play().catch(() => {});
    setActiveSentence(i);
  }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  }

  // Seek by clicking a point on the waveform (x-fraction × duration).
  function seekWave(e: React.MouseEvent) {
    const a = audioRef.current;
    const w = waveRef.current;
    if (!a || !w || !duration) return;
    const rect = w.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = frac * duration;
    setCurrentTime(a.currentTime);
  }

  // Keyboard a11y for the waveform slider: ←/→ scrub ±5s, Space/Enter toggles play.
  function onWaveKey(e: React.KeyboardEvent) {
    const a = audioRef.current;
    if (!a) return;
    if (e.key === "ArrowRight") { e.preventDefault(); a.currentTime = Math.min(duration, a.currentTime + 5); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); a.currentTime = Math.max(0, a.currentTime - 5); }
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); togglePlay(); }
  }

  // Render annotation segments (shared by sync per-sentence + static whole-transcript).
  // A mark click selects the note (and must not bubble to the sentence's seek handler).
  function renderSegments(segs: AnnoSegment[], keyPrefix: string | number) {
    return segs.map((seg, i) => {
      if (seg.annIndex === null) return <span key={`${keyPrefix}-${i}`}>{seg.text}</span>;
      const idx = seg.annIndex;
      const ts = TYPE_STYLE[annotations[idx].type];
      const on = active === idx;
      return (
        <mark
          key={`${keyPrefix}-${i}`}
          onClick={(e) => { e.stopPropagation(); setActive(idx); }}
          style={{
            background: ts.tint,
            color: "inherit",
            textDecorationLine: "underline",
            textDecorationStyle: ts.deco,
            textDecorationColor: ts.accent,
            textUnderlineOffset: 3,
            borderRadius: 3,
            padding: "0 1px",
            cursor: "pointer",
            boxShadow: on ? `0 0 0 2px ${ts.accent}` : "none",
          }}
        >
          {seg.text}
          <sup style={S.sup}>{idx + 1}</sup>
        </mark>
      );
    });
  }

  return (
    <section>
      <style>{CSS}</style>
      <div style={S.head}>
        <h2 style={S.h2}>Transcript</h2>
        <span style={S.annotatedPill}>Annotated</span>
        <span style={S.wordCount}>{words} words</span>
      </div>
      <p style={S.help}>
        {sync
          ? "Play your take — the current line lights up. Tap any line to jump there. Tap a highlight or note for feedback."
          : "Tap a highlight or a note — they’re linked. The underline style marks the kind of note."}
      </p>

      <div className="st-grid" style={S.grid}>
        {/* Left column (player + transcript) pins on desktop while the cards scroll —
            mirrors Writing's .wf-annoessay, killing the empty space a short transcript
            otherwise leaves. minWidth:0 so a nowrap quote can't blow out the columns. */}
        <div className="st-left" style={S.left}>
          {sync && (
            <div style={S.player}>
              <audio
                ref={audioRef}
                src={audioUrl ?? undefined}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                onTimeUpdate={onTimeUpdate}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                style={{ display: "none" }}
              />
              <button type="button" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"} style={S.playBtn}>
                {isPlaying ? PAUSE_ICON : PLAY_ICON}
              </button>
              <div
                ref={waveRef}
                className="st-wave"
                onClick={seekWave}
                onKeyDown={onWaveKey}
                role="slider"
                aria-label="Seek through your recording"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(currentTime)}
                tabIndex={0}
                style={S.wave}
              >
                {BAR_HEIGHTS.map((h, i) => {
                  const played = duration > 0 && (i + 1) / WAVE_BARS <= currentTime / duration;
                  return (
                    <span
                      key={i}
                      className="st-bar"
                      style={{ height: `${Math.round(h * 100)}%`, background: played ? "var(--brand)" : "var(--border-strong)" }}
                    />
                  );
                })}
              </div>
              <span style={S.ptime}>{fmtTime(currentTime)} / {fmtTime(duration)}</span>
            </div>
          )}
          <div style={S.body}>
            {sync
              ? timings.map((sent, i) => {
                  const now = activeSentence === i;
                  const played = activeSentence > i;
                  return (
                    <span
                      key={i}
                      className="st-sentence"
                      onClick={() => seekTo(i)}
                      style={{
                        ...S.sentence,
                        ...(now ? S.sentNow : played ? S.sentPlayed : null),
                      }}
                    >
                      {renderSegments(buildAnnotationSegments(sent.text, quotes), i)}
                    </span>
                  );
                })
              : renderSegments(segments, "s")}
          </div>
        </div>

        <div style={S.notes}>
          {annotations.map((a, i) => {
            const ts = TYPE_STYLE[a.type];
            const on = active === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setActive(i)}
                style={{ ...S.noteCard, borderLeft: `3px solid ${ts.accent}`, background: on ? ts.tint : "var(--surface)" }}
              >
                <span style={S.noteTop}>
                  <span style={{ ...S.noteNum, background: ts.accent }}>{a.type === "pause" ? "▍" : i + 1}</span>
                  <span style={{ ...S.noteType, color: ts.accent }}>{ts.legend}</span>
                </span>
                {a.quote && a.type !== "pause" && <span style={S.noteQuote}>“{a.quote}”</span>}
                <span style={S.noteComment}>{a.comment}</span>
              </button>
            );
          })}
          {annotations.length === 0 && <p style={S.noNotes}>No annotations — a clean run.</p>}
        </div>
      </div>

      {/* Legend */}
      <div style={S.legendCard}>
        {LEGEND_ORDER.map((t) => {
          const ts = TYPE_STYLE[t];
          return (
            <div key={t} style={S.legendRow}>
              <span style={S.legendSample}>
                {t === "pause" ? (
                  <span style={S.pauseChip}>▍</span>
                ) : (
                  <span
                    style={{
                      background: ts.tint,
                      textDecorationLine: "underline",
                      textDecorationStyle: ts.deco,
                      textDecorationColor: ts.accent,
                      textUnderlineOffset: 3,
                      borderRadius: 3,
                      padding: "0 4px",
                    }}
                  >
                    abc
                  </span>
                )}
              </span>
              <span style={S.legendName}>{ts.legend}</span>
              <span style={S.legendDeco}>{ts.decoName}</span>
              <span style={S.legendDef}>{ts.def}</span>
            </div>
          );
        })}
        <p style={S.legendNote}>Each type has its own underline style, so the marks read without relying on colour.</p>
      </div>

      {/* Footer */}
      <div style={S.footer}>
        <span style={S.stored}>
          <Icon name="lock" size={14} strokeWidth={2.2} style={{ color: "var(--text-muted)" }} /> Stored privately.
        </span>
        {confirming ? (
          <span style={S.confirmRow}>
            <span style={S.confirmText}>Delete audio + transcript?</span>
            <Button size="sm" variant="danger" icon="trash" loading={busy} disabled={busy} onClick={del}>Delete</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} style={S.deleteBtn}>
            <Icon name="trash" size={14} strokeWidth={2.2} /> Delete recording
          </button>
        )}
      </div>
    </section>
  );
}

const CSS = `
.st-grid{grid-template-columns:1fr}
/* Desktop (>=760px): wider transcript + a card column, and pin the transcript so it
   stays in view while the cards scroll (matches Writing's annotations layout). On mobile
   it stacks (transcript above cards), so no sticky. */
@media (min-width:760px){
  .st-grid{grid-template-columns:1.45fr 1fr}
  .st-left{position:sticky;top:88px;align-self:start;max-height:calc(100vh - 104px);overflow:auto}
}
.st-sentence:hover{background:var(--surface-hover)}
.st-wave{cursor:pointer;outline:none}
.st-wave:focus-visible{box-shadow:0 0 0 2px var(--brand-border);border-radius:6px}
.st-bar{flex:1;border-radius:2px;align-self:center;transition:background .15s,height .15s}
@media (prefers-reduced-motion:reduce){.st-bar,.st-sentence{transition:none}}
`;

const S: Record<string, CSSProperties> = {
  head: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 },
  h2: { margin: 0, fontSize: 16, fontWeight: 800, color: "var(--text-primary)" },
  annotatedPill: { fontSize: 11, fontWeight: 700, color: "var(--text-link)", background: "var(--brand-subtle)", padding: "2px 9px", borderRadius: "var(--radius-full)" },
  wordCount: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" },
  help: { margin: "0 0 14px", fontSize: 13.5, color: "var(--text-muted)" },

  grid: { display: "grid", gap: 16, alignItems: "start" },
  // The transcript card (own border) — no longer wraps the note column, so the cards sit
  // in a tidy column instead of floating inside a shared box. minWidth:0 holds the split.
  left: { minWidth: 0, border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--surface)", padding: 18 },
  body: { minWidth: 0, fontFamily: "var(--font-reading)", fontSize: 16, lineHeight: 2, color: "var(--text-primary)", whiteSpace: "pre-wrap" },
  sentence: { cursor: "pointer", borderRadius: 4, padding: "1px 2px", transition: "background .15s ease, color .15s ease", WebkitBoxDecorationBreak: "clone", boxDecorationBreak: "clone" },
  sentNow: { background: "var(--brand)", color: "#fff", fontWeight: 700 },
  sentPlayed: { color: "var(--text-muted)" },
  sup: { fontSize: 9, fontWeight: 700, marginLeft: 1, verticalAlign: "super", fontFamily: "var(--font-mono)" },

  player: { display: "flex", alignItems: "center", gap: 14, background: "var(--surface-inset)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px", marginBottom: 14 },
  playBtn: { flex: "none", width: 46, height: 46, borderRadius: "var(--radius-full)", background: "var(--brand)", color: "#fff", border: "none", display: "grid", placeItems: "center", boxShadow: "0 3px 0 0 var(--violet-700)", cursor: "pointer" },
  wave: { flex: 1, display: "flex", alignItems: "center", gap: 2, height: 34, minWidth: 0 },
  ptime: { flex: "none", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--text-muted)" },

  notes: { minWidth: 0, display: "flex", flexDirection: "column", gap: 10 },
  noteCard: { display: "flex", flexDirection: "column", gap: 5, textAlign: "left", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px", cursor: "pointer", fontFamily: "var(--font-ui)", transition: "background-color .15s ease" },
  noteTop: { display: "flex", alignItems: "center", gap: 8 },
  noteNum: { flex: "none", minWidth: 18, height: 18, padding: "0 4px", borderRadius: 6, display: "grid", placeItems: "center", color: "white", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700 },
  noteType: { fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" },
  // Ellipsis the quote so a long line can't distend the card column (Writing's cardQuote).
  noteQuote: { fontFamily: "var(--font-reading)", fontStyle: "italic", fontSize: 13.5, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  noteComment: { fontSize: 13.5, lineHeight: 1.5, color: "var(--text-primary)" },
  noNotes: { margin: 0, fontSize: 13, color: "var(--text-muted)" },

  legendCard: { marginTop: 16, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 },
  legendRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 13 },
  legendSample: { flex: "none", width: 40, fontFamily: "var(--font-reading)", fontSize: 14 },
  pauseChip: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-secondary)", background: "var(--surface-inset)", border: "1px solid var(--border-strong)", borderRadius: 5, padding: "1px 6px" },
  legendName: { flex: "none", width: 92, fontWeight: 700, color: "var(--text-primary)" },
  legendDeco: { flex: "none", width: 56, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" },
  legendDef: { flex: 1, minWidth: 160, color: "var(--text-secondary)" },
  legendNote: { margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" },

  footer: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" },
  stored: { display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--text-muted)" },
  confirmRow: { display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  confirmText: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" },
  deleteBtn: { display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "transparent", color: "var(--error-text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 4 },

  removedCard: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 28 },
  removedCircle: { display: "grid", placeItems: "center", width: 56, height: 56, borderRadius: "var(--radius-full)", background: "var(--error-subtle)" },
  removedTitle: { margin: 0, fontSize: 18, fontWeight: 800, color: "var(--text-primary)" },
  removedBody: { margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--text-secondary)", maxWidth: "42ch" },
};
