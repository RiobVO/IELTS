"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import { blockerIndex, sortWeakestFirst } from "@/lib/writing/feedback-view";
import { criterionLabel } from "@/lib/writing/labels";
import type { FeedbackResult } from "@/lib/writing/read";
import { BandHero } from "./_feedback/BandHero";
import { TopFixes } from "./_feedback/TopFixes";
import { CriteriaPlot, type PlotRow } from "./_feedback/CriteriaPlot";
import { Annotations, type Anno } from "./_feedback/Annotations";
import { Rewrite } from "./_feedback/Rewrite";
import { Checklist } from "./_feedback/Checklist";

/**
 * Feedback orchestrator. Shows exactly the engine's output — the blocker and the
 * weakest-first ordering are DERIVED here (lowest band midpoint), not extra model
 * fields. The snapshot never recomputes.
 */
export function FeedbackView({ data, targetBand }: { data: FeedbackResult; targetBand: number }) {
  const { feedback, taskPart } = data;
  const criteria = feedback.criteria;
  const blocker = criteria[blockerIndex(criteria)];
  const rows: PlotRow[] = sortWeakestFirst(criteria).map((c) => ({
    label: criterionLabel(c.name, taskPart),
    bandLow: c.bandLow,
    bandHigh: c.bandHigh,
    strength: c.strength,
    mainIssue: c.mainIssue,
    nextStep: c.nextStep,
    isBlocker: c === blocker,
  }));

  return (
    <div style={S.wrap}>
      <style>{CSS}</style>

      <header style={S.header}>
        <div>
          <div style={S.overline}>Feedback · {taskPart === "task1" ? "Task 1" : "Task 2"}</div>
          <h1 style={S.h1}>Nice work finishing — here&apos;s where to focus next</h1>
        </div>
        <Link href="/app/writing/history" style={S.historyPill} className="wf-pill">
          View in history
        </Link>
      </header>

      <BandHero
        bandLow={data.bandLow}
        bandHigh={data.bandHigh}
        confidence={data.confidence}
        blockerName={criterionLabel(blocker.name, taskPart)}
        blockerNote={blocker.mainIssue}
      />

      <TopFixes fixes={feedback.topFixes} />
      <CriteriaPlot rows={rows} targetBand={targetBand} />
      <Annotations essay={data.essay} annotations={feedback.annotations as Anno[]} />
      <Rewrite rewrite={feedback.rewrite} />
      <Checklist items={feedback.checklist} />

      <footer style={S.footer}>
        <Button trailingIcon="arrow-right" href="/app/writing">Write another essay</Button>
        <Button variant="secondary" href="/app/writing/history">View history</Button>
        <p style={S.snapNote}>
          This feedback is saved as a snapshot — reopen it any time and it won&apos;t change.
        </p>
      </footer>
    </div>
  );
}

const CSS = `
.wf-herogrid{grid-template-columns:1fr}
.wf-fixgrid{grid-template-columns:1fr}
.wf-annogrid{grid-template-columns:1fr}
.wf-plotrow{grid-template-columns:1fr}
.wf-pill:hover{background:var(--surface-hover)!important}
.wf-check:hover{background:var(--surface-hover)!important}
@media (min-width:760px){
  .wf-herogrid{grid-template-columns:330px 1fr}
  .wf-fixgrid{grid-template-columns:repeat(3,1fr)}
  .wf-annogrid{grid-template-columns:1.45fr 1fr}
  .wf-plotrow{grid-template-columns:1fr 240px}
}
/* Тап-таргет пилюли истории 38px < 44px на узких телефонах. */
@media (max-width:430px){
  .wf-pill{min-height:44px}
  /* CriteriaPlot/BandHero микро-текст: цифры оси → 11px минимум, смысловые
     лейблы (TARGET-метка, Strength/Watch/Next, "Biggest blocker") → 12px. */
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

  footer: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 8, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" },
  snapNote: { flexBasis: "100%", margin: 0, fontSize: 13, color: "var(--text-muted)" },
};
