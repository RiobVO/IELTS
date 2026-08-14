"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import { blockerIndex, sortWeakestFirst } from "@/lib/writing/feedback-view";
import { speakingCriterionLabel } from "@/lib/speaking/labels";
import type { SpeakingFeedbackResult } from "@/lib/speaking/read";
import { BandHero } from "../../../writing/result/[id]/_feedback/BandHero";
import { TopFixes } from "../../../writing/result/[id]/_feedback/TopFixes";
import { CriteriaPlot, type PlotRow } from "../../../writing/result/[id]/_feedback/CriteriaPlot";
import { Transcript, type SpeakAnno } from "./_Transcript";
import { Rewrites, type Rewrite } from "./_Rewrites";

/**
 * Speaking result. Reuses the Writing band hero + top-fixes + criteria-plot
 * components (the band/criteria UI is shared, per the handoff); the annotated
 * transcript is the one Speaking-specific block. The blocker + weakest-first order
 * are DERIVED here (lowest band midpoint), never extra model fields.
 */
export function SpeakingResult({
  data,
  targetBand,
  audioUrl,
}: {
  data: Omit<SpeakingFeedbackResult, "audioPath">; // audioPath is server-only (#19)
  targetBand: number;
  /** Short-lived signed playback URL while the take exists; null → no player. */
  audioUrl: string | null;
}) {
  const criteria = data.criteria;
  const blocker = criteria[blockerIndex(criteria)];
  const rows: PlotRow[] = sortWeakestFirst(criteria).map((c) => ({
    label: speakingCriterionLabel(c.name),
    bandLow: c.bandLow,
    bandHigh: c.bandHigh,
    strength: c.strength,
    mainIssue: c.mainIssue,
    nextStep: c.nextStep,
    isBlocker: c === blocker,
  }));
  // The transcript is "removed" only when it was actually wiped — i.e. a user delete
  // (deleteSpeakingRecording empties transcript). Retention deletes the AUDIO after
  // every successful eval (audioDeleted set on every completed result) but KEEPS the
  // transcript, so audioDeleted must NOT gate the annotated-transcript block here.
  const removed = data.transcript.trim() === "";
  // In karaoke mode the player lives inside the transcript (synced highlight + seek), so
  // the standalone top player is hidden to avoid two <audio> elements for one take.
  const sync = audioUrl !== null && data.transcriptTimings.length > 0 && !removed;

  return (
    <div style={S.wrap}>
      {/* Grid CSS the reused BandHero / CriteriaPlot rely on (lives in Writing's
          orchestrator; replicated here so the standalone reuse keeps its layout). */}
      <style>{GRID_CSS}</style>

      <header style={S.header}>
        <div>
          <div style={S.overline}>Feedback · Part 2</div>
          <h1 style={S.h1}>Nice work — here&apos;s where to focus next</h1>
        </div>
        <Link href="/app/speaking/history" style={S.historyPill} className="sr-pill">
          View in history
        </Link>
      </header>

      <BandHero
        bandLow={data.bandLow}
        bandHigh={data.bandHigh}
        confidence={data.confidence}
        blockerName={speakingCriterionLabel(blocker.name)}
        blockerNote={blocker.mainIssue}
      />

      <TopFixes fixes={data.topFixes} />
      <CriteriaPlot rows={rows} targetBand={targetBand} />

      <Rewrites rewrites={data.rewrites as Rewrite[]} />

      {audioUrl && !sync && (
        <section style={S.playerCard}>
          <div style={S.playerLabel}>
            <Icon name="play" size={15} strokeWidth={2.3} style={{ color: "var(--text-link)" }} /> Your recording
          </div>
          <audio controls src={audioUrl} style={{ width: "100%" }} />
          <p style={S.playerNote}>
            Replay your take to study it. It&apos;s kept privately for up to 7 days, then auto-deleted — or remove it now from the transcript below.
          </p>
        </section>
      )}

      <Transcript
        submissionId={data.submissionId}
        transcript={data.transcript}
        annotations={data.annotations as SpeakAnno[]}
        timings={data.transcriptTimings}
        audioUrl={audioUrl}
        removed={removed}
      />

      {data.drills.length > 0 && (
        <section>
          <h2 style={S.h2}>Drills to practise</h2>
          <ul style={S.drillList}>
            {data.drills.map((d, i) => (
              <li key={i} style={S.drillItem}>
                <Icon name="dumbbell" size={16} strokeWidth={2.2} style={{ color: "var(--text-link)", flex: "none", marginTop: 2 }} />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div style={S.roundoff}>
        <Icon name="info" size={18} strokeWidth={2.2} style={{ color: "var(--info)", flex: "none", marginTop: 1 }} />
        <span>
          On the real exam the examiner asks 1–2 short follow-ups after your monologue — here we train the long-turn itself.
        </span>
      </div>

      <footer style={S.footer}>
        <Button trailingIcon="arrow-right" href="/app/speaking">Record another</Button>
        <Button variant="secondary" href="/app/speaking/history">View history</Button>
        <p style={S.snapNote}>
          This feedback is saved as a snapshot — reopen it any time and it won&apos;t change.
        </p>
      </footer>
    </div>
  );
}

const GRID_CSS = `
.wf-herogrid{grid-template-columns:1fr}
.wf-plotrow{grid-template-columns:1fr}
.sr-pill:hover{background:var(--surface-hover)!important}
@media (min-width:760px){
  .wf-herogrid{grid-template-columns:330px 1fr}
  .wf-plotrow{grid-template-columns:1fr 240px}
}
/* Тап-таргет пилюли истории 38px < 44px на touch (не только узкий телефон). */
@media (pointer:coarse){
  .sr-pill{min-height:44px}
}
@media (max-width:430px){
  /* CriteriaPlot/BandHero микро-текст (см. Writing _FeedbackView.tsx — тот же реюз). */
  .wf-plot-tick{font-size:11px!important}
  .wf-plot-targetmark{font-size:12px!important}
  .wf-plot-linelabel{font-size:12px!important}
  .wf-blocker-badge{font-size:12px!important}
}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 980, margin: "0 auto", padding: "20px 16px 56px", display: "flex", flexDirection: "column", gap: 24, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  overline: { fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-link)", marginBottom: 8 },
  h1: { margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, color: "var(--text-primary)", textWrap: "balance" },
  historyPill: { flex: "none", display: "inline-flex", alignItems: "center", height: 38, padding: "0 16px", borderRadius: "var(--radius-full)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)", fontSize: 13, fontWeight: 700, textDecoration: "none", transition: "var(--transition-colors)" },

  h2: { margin: "0 0 12px", fontSize: 16, fontWeight: 800, color: "var(--text-primary)" },

  playerCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 },
  playerLabel: { display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "var(--text-primary)" },
  playerNote: { margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" },

  drillList: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 },
  drillItem: { display: "flex", gap: 10, alignItems: "flex-start", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px", fontSize: 14, lineHeight: 1.5, color: "var(--text-secondary)" },

  roundoff: { display: "flex", gap: 10, alignItems: "flex-start", background: "var(--info-subtle)", border: "1px solid color-mix(in oklab, var(--info) 40%, transparent)", borderRadius: "var(--radius-md)", padding: "14px 16px", fontSize: 13.5, lineHeight: 1.5, color: "var(--text-secondary)" },

  footer: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 8, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" },
  snapNote: { flexBasis: "100%", margin: 0, fontSize: 13, color: "var(--text-muted)" },
};
