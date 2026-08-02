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

/**
 * Speaking result. Reuses the Writing band hero + top-fixes + criteria-plot
 * components (the band/criteria UI is shared, per the handoff); the annotated
 * transcript is the one Speaking-specific block. The blocker + weakest-first order
 * are DERIVED here (lowest band midpoint), never extra model fields.
 */
export function SpeakingResult({ data, targetBand }: { data: SpeakingFeedbackResult; targetBand: number }) {
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
  const removed = data.transcript.trim() === "" || data.audioDeleted;

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

      <Transcript
        submissionId={data.submissionId}
        transcript={data.transcript}
        annotations={data.annotations as SpeakAnno[]}
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
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 980, margin: "0 auto", padding: "20px 16px 56px", display: "flex", flexDirection: "column", gap: 24, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  overline: { fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-link)", marginBottom: 8 },
  h1: { margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, color: "var(--text-primary)", textWrap: "balance" },
  historyPill: { flex: "none", display: "inline-flex", alignItems: "center", height: 38, padding: "0 16px", borderRadius: "var(--radius-full)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)", fontSize: 13, fontWeight: 700, textDecoration: "none", transition: "var(--transition-colors)" },

  h2: { margin: "0 0 12px", fontSize: 16, fontWeight: 800, color: "var(--text-primary)" },
  drillList: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 },
  drillItem: { display: "flex", gap: 10, alignItems: "flex-start", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px", fontSize: 14, lineHeight: 1.5, color: "var(--text-secondary)" },

  roundoff: { display: "flex", gap: 10, alignItems: "flex-start", background: "var(--info-subtle)", border: "1px solid color-mix(in oklab, var(--info) 40%, transparent)", borderRadius: "var(--radius-md)", padding: "14px 16px", fontSize: 13.5, lineHeight: 1.5, color: "var(--text-secondary)" },

  footer: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 8, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" },
  snapNote: { flexBasis: "100%", margin: 0, fontSize: 13, color: "var(--text-muted)" },
};
