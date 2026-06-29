"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import { buildAnnotationSegments } from "@/lib/writing/feedback-view";
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

export function Transcript({
  submissionId,
  transcript,
  annotations,
  removed: removedInitial,
}: {
  submissionId: string;
  transcript: string;
  annotations: SpeakAnno[];
  removed: boolean;
}) {
  const router = useRouter();
  const [active, setActive] = useState<number | null>(null);
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

  return (
    <section>
      <style>{CSS}</style>
      <div style={S.head}>
        <h2 style={S.h2}>Transcript</h2>
        <span style={S.annotatedPill}>Annotated</span>
        <span style={S.wordCount}>{words} words</span>
      </div>
      <p style={S.help}>Tap a highlight or a note — they&apos;re linked. The underline style marks the kind of note.</p>

      <div className="st-grid" style={S.grid}>
        <div style={S.body}>
          {segments.map((seg, i) => {
            if (seg.annIndex === null) return <span key={i}>{seg.text}</span>;
            const idx = seg.annIndex;
            const ts = TYPE_STYLE[annotations[idx].type];
            const on = active === idx;
            return (
              <mark
                key={i}
                onClick={() => setActive(idx)}
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
          })}
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
@media (min-width:760px){.st-grid{grid-template-columns:1fr 250px}}
`;

const S: Record<string, CSSProperties> = {
  head: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 },
  h2: { margin: 0, fontSize: 16, fontWeight: 800, color: "var(--text-primary)" },
  annotatedPill: { fontSize: 11, fontWeight: 700, color: "var(--text-link)", background: "var(--brand-subtle)", padding: "2px 9px", borderRadius: "var(--radius-full)" },
  wordCount: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" },
  help: { margin: "0 0 14px", fontSize: 13.5, color: "var(--text-muted)" },

  grid: { display: "grid", gap: 16, alignItems: "start", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--surface)", padding: 20 },
  body: { minWidth: 0, fontFamily: "var(--font-reading)", fontSize: 16, lineHeight: 2, color: "var(--text-primary)", whiteSpace: "pre-wrap" },
  sup: { fontSize: 9, fontWeight: 700, marginLeft: 1, verticalAlign: "super", fontFamily: "var(--font-mono)" },

  notes: { minWidth: 0, display: "flex", flexDirection: "column", gap: 10 },
  noteCard: { display: "flex", flexDirection: "column", gap: 5, textAlign: "left", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px", cursor: "pointer", fontFamily: "var(--font-ui)" },
  noteTop: { display: "flex", alignItems: "center", gap: 8 },
  noteNum: { flex: "none", minWidth: 18, height: 18, padding: "0 4px", borderRadius: 6, display: "grid", placeItems: "center", color: "white", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700 },
  noteType: { fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" },
  noteQuote: { fontFamily: "var(--font-reading)", fontStyle: "italic", fontSize: 13, color: "var(--text-primary)" },
  noteComment: { fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" },
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
