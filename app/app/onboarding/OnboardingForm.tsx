"use client";

import { useState } from "react";
import { Button } from "@/components/core/Button";
import { Input } from "@/components/core/Input";
import { qtypeLabel } from "@/lib/labels";
import {
  DIAGNOSTIC_PASSAGE,
  DIAGNOSTIC_QUESTIONS,
  gradeDiagnostic,
  type DiagnosticResult,
} from "@/lib/onboarding/diagnostic";
import { completeOnboarding } from "./actions";

interface RegionOption {
  id: string;
  name: string;
}

const BANDS = ["4.0", "4.5", "5.0", "5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0"];

/**
 * Two-step onboarding wizard. Step 1 captures identity (submitted to
 * completeOnboarding). Step 2 is the mini-diagnostic (W1-2b): a self-contained
 * 6-question test graded client-side that surfaces the user's weak type before
 * their first real test. Identity fields stay mounted (hidden) on step 2 so they
 * still reach the final form submit; Skip and "Start practising" both submit.
 */
export default function OnboardingForm({
  regions,
  error,
  defaultName,
}: {
  regions: RegionOption[];
  error: string | null;
  defaultName: string;
}) {
  const [step, setStep] = useState<"identity" | "diagnostic">("identity");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<DiagnosticResult | null>(null);

  const goNext = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Validate the identity fields (required) before advancing — reportValidity
    // surfaces the native messages; the diagnostic inputs aren't in the form.
    const form = e.currentTarget.closest("form");
    if (form && !form.reportValidity()) return;
    setStep("diagnostic");
  };

  const setAns = (n: number, v: string) => setAnswers((a) => ({ ...a, [n]: v }));

  const heading =
    step === "identity"
      ? { eyebrow: "Welcome to bando", title: "Let's set up your prep", lead: "Twenty seconds. This sets your band target and puts you on the right league." }
      : result
        ? { eyebrow: "Your starting point", title: result.weakType ? "Found your weak spot" : "Strong start", lead: "" }
        : { eyebrow: "Quick check", title: "Find your weak spot", lead: "Six questions, about three minutes. Read the passage, then answer." };

  return (
    <div style={S.screen}>
      <div style={{ ...S.card, maxWidth: step === "diagnostic" ? 620 : 460 }}>
        <div style={S.eyebrow}>{heading.eyebrow}</div>
        <h1 style={S.h1}>{heading.title}</h1>
        {heading.lead && <p style={S.lead}>{heading.lead}</p>}

        {error && step === "identity" && <div style={S.error}>{error}</div>}

        <form action={completeOnboarding} style={S.form}>
          {/* Step 1 — identity. Kept mounted (hidden on step 2) so it submits. */}
          <div style={{ display: step === "identity" ? "flex" : "none", flexDirection: "column", gap: 18 }}>
            <label style={S.field}>
              <span style={S.label}>Display name</span>
              <Input name="display_name" defaultValue={defaultName} placeholder="How you appear on the leaderboard" maxLength={40} required />
            </label>

            <label style={S.field}>
              <span style={S.label}>
                Region <span style={S.opt}>· optional</span>
              </span>
              <select name="region_id" defaultValue="" style={S.select}>
                <option value="">Prefer not to say</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={S.field}>
              <span style={S.label}>Target band</span>
              <select name="target_band" defaultValue="7.0" style={S.select} required>
                {BANDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ marginTop: 8 }}>
              <Button type="button" size="lg" fullWidth trailingIcon="arrow-right" onClick={goNext}>
                Continue
              </Button>
            </div>
          </div>

          {/* Step 2 — diagnostic (questions, then result). No form inputs here. */}
          {step === "diagnostic" && !result && (
            <div>
              <div style={S.passage}>{DIAGNOSTIC_PASSAGE}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {DIAGNOSTIC_QUESTIONS.map((q) => (
                  <div key={q.number} style={S.q}>
                    <div style={S.qPrompt}>
                      <span style={S.qNum}>Q{q.number}</span> {q.prompt}
                    </div>
                    {q.options ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {q.options.map((opt) => {
                          const on = answers[q.number] === opt;
                          return (
                            <button
                              type="button"
                              key={opt}
                              onClick={() => setAns(q.number, opt)}
                              style={{ ...S.opt2, ...(on ? S.optOn : null) }}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <Input
                        placeholder="Type one word from the passage"
                        value={answers[q.number] ?? ""}
                        onChange={(e) => setAns(q.number, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
                <Button type="button" size="lg" fullWidth trailingIcon="arrow-right" onClick={() => setResult(gradeDiagnostic(answers))}>
                  See my result
                </Button>
                <button type="submit" style={S.skip}>
                  Skip for now
                </button>
              </div>
            </div>
          )}

          {step === "diagnostic" && result && (
            <div>
              <div style={S.resultCard}>
                <div style={S.resultScore}>
                  {result.correct}<span style={S.resultScoreTot}>/{result.total}</span>
                </div>
                {result.weakType ? (
                  <>
                    <div style={S.resultLabel}>Your weakest type</div>
                    <div style={S.resultType}>{qtypeLabel(result.weakType)}</div>
                    <p style={S.resultText}>
                      Start by drilling this question type — it has the biggest impact on your band.
                    </p>
                  </>
                ) : (
                  <p style={{ ...S.resultText, marginTop: 14 }}>
                    Perfect score — a strong start. Sit a full mock to get your band.
                  </p>
                )}
              </div>
              <div style={{ marginTop: 20 }}>
                <Button type="submit" size="lg" fullWidth trailingIcon="arrow-right">
                  Start practising
                </Button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  screen: { minHeight: "100dvh", background: "var(--bg-base)", display: "grid", placeItems: "center", padding: "32px 18px" },
  card: { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-lg)", padding: "34px 32px 36px" },
  eyebrow: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--brand)" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-3xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "8px 0 6px" },
  lead: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", color: "var(--text-muted)", margin: "0 0 24px", lineHeight: 1.5 },
  error: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--error-text)", background: "var(--error-subtle)", border: "1px solid var(--error)", borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 18 },
  form: { display: "block" },
  field: { display: "flex", flexDirection: "column", gap: 7 },
  label: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-secondary)" },
  opt: { fontWeight: 500, color: "var(--text-muted)" },
  select: { height: 50, padding: "0 14px", background: "var(--surface-raised)", border: "2px solid var(--border)", borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", color: "var(--text-primary)", cursor: "pointer", appearance: "none" },

  passage: { fontFamily: "var(--font-reading)", fontSize: "var(--text-base)", lineHeight: "var(--leading-relaxed)", color: "var(--reading-text)", background: "var(--reading-surface)", border: "1px solid var(--reading-rule)", borderRadius: "var(--radius-lg)", padding: "18px 20px", marginBottom: 22, maxHeight: 220, overflowY: "auto" },
  q: { display: "flex", flexDirection: "column", gap: 10 },
  qPrompt: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.5 },
  qNum: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginRight: 4 },
  opt2: { padding: "8px 14px", border: "2px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-raised)", color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, cursor: "pointer", transition: "var(--transition-colors)" },
  optOn: { borderColor: "var(--brand)", background: "var(--brand-subtle)", color: "var(--text-link)" },
  skip: { background: "transparent", border: "none", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, cursor: "pointer", padding: 6 },

  resultCard: { textAlign: "center", padding: "26px 22px", background: "linear-gradient(180deg, var(--brand-subtle), var(--surface))", border: "2px solid var(--brand-border)", borderRadius: "var(--radius-xl)" },
  resultScore: { fontFamily: "var(--font-mono)", fontSize: "var(--text-4xl)", fontWeight: 700, color: "var(--brand)", lineHeight: 1 },
  resultScoreTot: { color: "var(--text-muted)", fontSize: "var(--text-2xl)" },
  resultLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)", marginTop: 16 },
  resultType: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: 800, color: "var(--text-primary)", marginTop: 4 },
  resultText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5, margin: "10px auto 0", maxWidth: 360 },
};
