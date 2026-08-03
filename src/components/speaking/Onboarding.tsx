"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/core/Button";
import { Icon, type IconName } from "@/components/core/icons";

/**
 * First-run explainer (handoff §5). A one-time card that frames the three beats of
 * a Speaking attempt — prep, speak, feedback — plus the reassurance that nothing is
 * final until submit. Dismissed forever via localStorage (`speaking_onboarded`).
 *
 * Self-gating: renders null on the server and until the effect reads localStorage,
 * so there is no hydration mismatch and a returning user never sees a flash.
 */
const KEY = "speaking_onboarded";

const STEPS: { icon: IconName; label: string; title: string; body: string }[] = [
  { icon: "book-open", label: "1 · Prep", title: "Read the cue-card", body: "Plan your answer for up to a minute before you speak." },
  { icon: "mic", label: "2 · Speak", title: "Talk for 1–2 minutes", body: "Just like the real Part 2 long-turn." },
  { icon: "sparkles", label: "3 · Feedback", title: "Get an estimated band", body: "Plus an annotated transcript of what you said." },
];

export function Onboarding() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true);
    } catch {
      // localStorage blocked (private mode / disabled) — just show it; the dismiss
      // simply won't persist, which is acceptable for a one-time explainer.
      setShow(true);
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* non-persistent dismiss is fine */
    }
    setShow(false);
  };

  return (
    <section style={S.card} aria-label="How Speaking Lab works">
      <div style={S.overline}>Speaking · how it works</div>
      <h3 style={S.h3}>Speak your answer, get a band</h3>

      <div className="sob-steps" style={S.steps}>
        <style>{CSS}</style>
        {STEPS.map((s) => (
          <div key={s.label} style={S.step}>
            <span style={S.chip} aria-hidden="true">
              <Icon name={s.icon} size={20} strokeWidth={2.2} style={{ color: "var(--brand)" }} />
            </span>
            <div style={S.stepLabel}>{s.label}</div>
            <div style={S.stepTitle}>{s.title}</div>
            <div style={S.stepBody}>{s.body}</div>
          </div>
        ))}
      </div>

      <div style={S.reassure}>
        <Icon name="check" size={16} strokeWidth={2.6} style={{ color: "var(--success-text)", flex: "none", marginTop: 1 }} />
        <span>You can re-record before submitting — nothing is final until you send it.</span>
      </div>

      <Button onClick={dismiss} fullWidth>Got it</Button>
    </section>
  );
}

const CSS = `
.sob-steps{grid-template-columns:1fr}
@media (min-width:640px){.sob-steps{grid-template-columns:repeat(3,1fr)}}
`;

const S: Record<string, CSSProperties> = {
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 22, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  overline: { fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-link)" },
  h3: { margin: "8px 0 18px", fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  steps: { display: "grid", gap: 16 },
  step: { display: "flex", flexDirection: "column" },
  chip: { display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 12, background: "var(--brand-subtle)", marginBottom: 12 },
  stepLabel: { fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" },
  stepTitle: { fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginTop: 6 },
  stepBody: { fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)", marginTop: 4 },
  reassure: { display: "flex", gap: 9, alignItems: "flex-start", margin: "20px 0", padding: "12px 14px", background: "var(--success-subtle)", borderRadius: "var(--radius-md)", fontSize: 13.5, lineHeight: 1.5, color: "var(--success-text)", fontWeight: 600 },
};
