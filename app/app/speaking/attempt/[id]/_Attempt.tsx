"use client";

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/core/Button";
import { Icon, type IconName } from "@/components/core/icons";
import { ConsentModal } from "@/components/speaking/ConsentModal";
import { EdgeCard } from "@/components/speaking/EdgeCard";
import { useSpeakingRecorder } from "@/components/speaking/useSpeakingRecorder";
import type { SpeakingCatalogTask } from "@/lib/speaking/read";
import { createSpeakingSubmission, getSpeakingStatus, markSpeakingUploaded } from "../../actions";

/**
 * Speaking attempt flow (handoff RecordScreen — 5 phases). FSM:
 *   prep → (timer ends OR Skip) → recording → (Stop OR cap) → stopped/short → (Submit) → analyzing.
 * Re-record returns straight to recording; Submit is blocked while the take is <10s
 * or near-silent (the silence guard, before the user spends their preview). All the
 * novel recording logic lives in useSpeakingRecorder; this component is the controller
 * + the bando-skinned phase UIs.
 */
const POLL_MS = 2500;
const MIN_SECONDS = 10;
const MIN_PEAK = 0.04;

type Gate = "preview_used" | "daily_cap" | "in_progress" | "failed";
type Step = "prep" | "active" | "analyzing" | Gate;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, "0")}`;

export function Attempt({ task, hasConsent }: { task: SpeakingCatalogTask; hasConsent: boolean }) {
  const router = useRouter();
  const recorder = useSpeakingRecorder(task.maxSpeakSeconds);

  const [mounted, setMounted] = useState(false);
  const [consented, setConsented] = useState(hasConsent);
  const [step, setStep] = useState<Step>("prep");
  const [prepLeft, setPrepLeft] = useState(task.prepSeconds);
  const [scratch, setScratch] = useState("");
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const startRecording = useCallback(() => {
    setStep("active");
    void recorder.start();
  }, [recorder]);

  // Prep countdown — runs only once consent is in and we're mounted. At 0 the take
  // begins automatically (design: "Recording starts automatically when prep ends").
  useEffect(() => {
    if (!mounted || !consented || step !== "prep") return;
    if (prepLeft <= 0) {
      startRecording();
      return;
    }
    const t = setTimeout(() => setPrepLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [mounted, consented, step, prepLeft, startRecording]);

  // Poll the async eval while analyzing; reaper/re-kick live server-side.
  useEffect(() => {
    if (step !== "analyzing" || !submissionId) return;
    let alive = true;
    const t = setInterval(async () => {
      const { status } = await getSpeakingStatus(submissionId);
      if (!alive) return;
      if (status === "completed") {
        clearInterval(t);
        router.push(`/app/speaking/result/${submissionId}`);
      } else if (status === "failed") {
        clearInterval(t);
        setStep("failed");
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [step, submissionId, router]);

  // Warn on navigation away while recording, or with an un-submitted take in hand.
  useEffect(() => {
    const dirty = recorder.state === "recording" || (recorder.clip != null && step !== "analyzing");
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [recorder.state, recorder.clip, step]);

  const leave = () => router.push("/app/speaking");

  function mapError(error: string) {
    switch (error) {
      case "preview_used": return setStep("preview_used");
      case "daily_cap": return setStep("daily_cap");
      case "already_in_progress": return setStep("in_progress");
      case "not_configured": return void router.push("/app/practice");
      case "consent_required": return setConsented(false);
      case "unauthorized": return void router.push("/auth");
      case "too_large": return setSubmitError("That recording is too large — record a shorter take.");
      case "too_fast": return setSubmitError("Too many attempts in a row. Wait a minute and try again.");
      case "unavailable": return void router.push("/app/speaking");
      default: return setStep("failed");
    }
  }

  async function submit() {
    const clip = recorder.clip;
    if (!clip || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createSpeakingSubmission(task.id, clip.ext);
      if ("error" in created) {
        mapError(created.error);
        return;
      }
      // MediaRecorder tags the blob with a codec param (e.g. "audio/webm;codecs=opus"),
      // but the bucket's allowed_mime_types is the bare type — send the base mime or
      // Supabase rejects the signed PUT with 415 invalid_mime_type.
      const put = await fetch(created.uploadUrl, {
        method: "PUT",
        headers: { "content-type": clip.blob.type.split(";")[0].trim() },
        body: clip.blob,
      });
      if (!put.ok) {
        setSubmitError("Upload failed — please try again.");
        return;
      }
      const marked = await markSpeakingUploaded(created.submissionId);
      if (!marked.ok) {
        mapError(marked.error ?? "failed");
        return;
      }
      setSubmissionId(created.submissionId);
      setStep("analyzing");
    } catch {
      setSubmitError("Something went wrong — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const rs = recorder.state;
  // Unsupported is the only state read at first paint; gate on mounted so SSR (where
  // MediaRecorder is undefined) and hydration agree before the effect resolves it.
  if (mounted && rs === "unsupported") {
    return (
      <Shell onClose={leave}>
        <div style={S.single}>
          <EdgeCard kind="unsupported" />
        </div>
      </Shell>
    );
  }

  if (step === "analyzing") return <Shell onClose={leave}><Analyzing onLeave={leave} /></Shell>;
  if (step === "preview_used" || step === "daily_cap" || step === "in_progress" || step === "failed") {
    return <Shell onClose={leave}><GateScreen step={step} onRetry={() => { setStep("prep"); setPrepLeft(task.prepSeconds); recorder.reset(); }} onBack={leave} /></Shell>;
  }

  const recording = step === "active" && rs === "recording";
  const starting = step === "active" && rs === "idle";
  const stopped = step === "active" && rs === "stopped";
  const edge = step === "active" && (rs === "denied" || rs === "no_device" || rs === "busy" || rs === "error");
  const clip = recorder.clip;
  const tooShort = !!clip && (clip.seconds < MIN_SECONDS || recorder.peak < MIN_PEAK);

  return (
    <>
      <Shell onClose={leave}>
        {edge ? (
          <div style={S.single}>
            <EdgeCard kind={rs as "denied" | "no_device" | "busy" | "error"} onRetry={() => void recorder.start()} />
          </div>
        ) : stopped ? (
          <div style={S.single}>
            <CueMini prompt={task.prompt} />
            <StoppedPanel
              clip={clip!}
              tooShort={tooShort}
              submitting={submitting}
              submitError={submitError}
              onSubmit={submit}
              onReRecord={() => void recorder.start()}
            />
          </div>
        ) : (
          <div className="sa-two" style={S.two}>
            <CueFull task={task} />
            <div>
              {step === "prep" && (
                <PrepPanel
                  prepLeft={prepLeft}
                  prepTotal={task.prepSeconds}
                  scratch={scratch}
                  setScratch={setScratch}
                  onSkip={startRecording}
                />
              )}
              {(recording || starting) && (
                <RecordingPanel
                  starting={starting}
                  seconds={recorder.seconds}
                  max={task.maxSpeakSeconds}
                  peak={recorder.peak}
                  onStop={recorder.stop}
                />
              )}
            </div>
          </div>
        )}
      </Shell>

      {!consented && (
        <ConsentModal onConsented={() => setConsented(true)} onCancel={leave} />
      )}
    </>
  );
}

/* ── Shell ──────────────────────────────────────────────────────────────── */
function Shell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div style={S.wrap}>
      <style>{CSS}</style>
      <div className="sa-shell" style={S.shell}>
        <div className="sa-headbar" style={S.headbar}>
          <span style={S.logoBars} aria-hidden="true">
            <span style={{ ...S.logoBar, height: 18, background: "var(--brand)" }} />
            <span style={{ ...S.logoBar, height: 13, background: "var(--slate-400)" }} />
            <span style={{ ...S.logoBar, height: 9, background: "var(--slate-300)" }} />
          </span>
          <span style={S.headTitle}>Speaking Lab</span>
          <span style={S.partPill}>Part 2 · Long turn</span>
          <button type="button" aria-label="Close" onClick={onClose} className="sa-close" style={S.close}>
            <Icon name="x" size={18} strokeWidth={2.2} />
          </button>
        </div>
        <div style={S.bodyPad}>{children}</div>
      </div>
    </div>
  );
}

/* ── Cue card ───────────────────────────────────────────────────────────── */
function CueFull({ task }: { task: SpeakingCatalogTask }) {
  return (
    <section aria-label="Cue card" style={S.cueFull}>
      <div style={S.cueOver}>Cue card · Part 2</div>
      <h2 style={S.cuePrompt}>{task.prompt}</h2>
      {task.bullets.length > 0 && (
        <>
          <div style={S.cueSay}>You should say:</div>
          <ul style={S.cueList}>
            {task.bullets.map((b, i) => (
              <li key={i} style={S.cueItem}>
                <span style={S.cueDot} aria-hidden="true" />
                {b}
              </li>
            ))}
          </ul>
        </>
      )}
      <div style={S.cueClose}>{task.closingPrompt}</div>
    </section>
  );
}

function CueMini({ prompt }: { prompt: string }) {
  return (
    <section aria-label="Cue card" style={S.cueMini}>
      <Icon name="book-open" size={18} strokeWidth={2} style={{ color: "var(--brand)", flex: "none" }} />
      <span style={S.cueMiniText}>{prompt}</span>
    </section>
  );
}

/* ── Prep ───────────────────────────────────────────────────────────────── */
function PrepPanel({
  prepLeft,
  prepTotal,
  scratch,
  setScratch,
  onSkip,
}: {
  prepLeft: number;
  prepTotal: number;
  scratch: string;
  setScratch: (v: string) => void;
  onSkip: () => void;
}) {
  const R = 74;
  const CIRC = 2 * Math.PI * R;
  const frac = prepTotal > 0 ? Math.max(0, Math.min(1, prepLeft / prepTotal)) : 0;
  const offset = CIRC * (1 - frac);
  return (
    <section style={S.col}>
      <div style={{ position: "relative", width: 172, height: 172, alignSelf: "center" }}>
        <svg width={172} height={172} viewBox="0 0 172 172" style={{ transform: "rotate(-90deg)" }}>
          <circle cx={86} cy={86} r={R} fill="none" stroke="var(--surface-inset)" strokeWidth={12} />
          <circle
            cx={86}
            cy={86}
            r={R}
            fill="none"
            stroke="var(--brand)"
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.95s linear" }}
          />
        </svg>
        <div style={S.ringCenter}>
          <span aria-live="polite" style={S.ringTime}>{mmss(prepLeft)}</span>
          <span style={S.ringLabel}>Prep time</span>
        </div>
      </div>
      <p style={S.prepHelp}>Plan your answer. Recording starts automatically when prep ends.</p>

      <div style={S.quietHint}>
        <Icon name="mic" size={16} strokeWidth={2} style={{ color: "var(--text-muted)", flex: "none", marginTop: 1 }} />
        <span style={S.quietText}>Find a quiet place. We&apos;ll listen for your voice the moment recording begins.</span>
      </div>

      <div style={{ width: "100%" }}>
        <label htmlFor="sa-scratch" style={S.scratchLabel}>Scratch notes (optional · not saved)</label>
        <textarea
          id="sa-scratch"
          value={scratch}
          onChange={(e) => setScratch(e.target.value)}
          placeholder="Jot a few keywords to structure your answer…"
          className="sa-scratch"
          style={S.scratch}
        />
      </div>

      <Button onClick={onSkip} variant="secondary" size="lg" fullWidth trailingIcon="arrow-right">
        Skip to recording
      </Button>
    </section>
  );
}

/* ── Recording ──────────────────────────────────────────────────────────── */
function RecordingPanel({
  starting,
  seconds,
  max,
  peak,
  onStop,
}: {
  starting: boolean;
  seconds: number;
  max: number;
  peak: number;
  onStop: () => void;
}) {
  if (starting) {
    return (
      <section style={{ ...S.col, alignItems: "center", paddingTop: 24 }}>
        <span className="sa-spin" style={S.startSpin} aria-hidden="true" />
        <p style={S.prepHelp} aria-live="polite">Requesting your microphone…</p>
      </section>
    );
  }
  const remaining = Math.max(0, max - seconds);
  const pct = max > 0 ? Math.min(100, (seconds / max) * 100) : 0;
  const lvl =
    peak >= 0.15
      ? { text: "Hearing you clearly", color: "var(--success-text)" }
      : peak >= MIN_PEAK
        ? { text: "We can hear you", color: "var(--text-secondary)" }
        : { text: "We can barely hear you — speak up", color: "var(--warn-text)" };

  return (
    <section className="sa-recpanel" style={S.col}>
      <div style={S.recCard}>
        <div style={S.recTopRow}>
          <span className="sa-recdot" style={S.recDot} aria-hidden="true" />
          <span style={S.recLabel}>Recording</span>
        </div>
        <span aria-live="assertive" style={S.recTime}>{mmss(seconds)}</span>
        <span style={S.srOnly}>Recording, {seconds} seconds of {mmss(max)} used.</span>
        <div style={{ width: "100%" }}>
          <div style={S.recRail}>
            <div style={{ ...S.recFill, width: `${pct}%` }} />
          </div>
          <div style={S.recRailMeta}>
            <span>{mmss(remaining)} left</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>cap {mmss(max)}</span>
          </div>
        </div>
      </div>

      <div role="group" aria-label="Microphone level" style={S.meterCard}>
        <div style={S.meterTop}>
          <Icon name="bar-chart" size={16} strokeWidth={2.2} style={{ color: lvl.color }} />
          <span aria-live="polite" style={{ ...S.meterStatus, color: lvl.color }}>{lvl.text}</span>
          <span style={S.meterPeak}>peak {peak.toFixed(2)}</span>
        </div>
        <div className="sa-eqrow" aria-hidden="true">
          {EQ_BARS.map((b, i) => (
            <span key={i} className="sa-eqbar" style={{ height: `${b.h}%`, animationDelay: `${b.d}ms` }} />
          ))}
        </div>
      </div>

      <div style={S.stopWrap}>
        <button type="button" aria-label="Stop recording" onClick={onStop} style={S.stopBtn}>
          <span style={S.stopGlyph} />
        </button>
        <span style={S.stopLabel}>Stop</span>
        <span style={S.stopHint}>Auto-stops at the {mmss(max)} cap.</span>
      </div>
    </section>
  );
}

/* ── Stopped ────────────────────────────────────────────────────────────── */
function StoppedPanel({
  clip,
  tooShort,
  submitting,
  submitError,
  onSubmit,
  onReRecord,
}: {
  clip: { url: string; seconds: number };
  tooShort: boolean;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
  onReRecord: () => void;
}) {
  return (
    <section style={S.col}>
      <div style={S.takeRow}>
        <Icon name="circle-check" size={20} strokeWidth={2.2} style={{ color: "var(--success-text)" }} />
        <span style={S.takeTitle}>Take captured</span>
        <span style={S.takeLen}>{mmss(clip.seconds)}</span>
      </div>

      <div style={S.playerCard}>
        {/* Native controls: reliable, accessible playback of the local take before submit. */}
        <audio controls src={clip.url} style={{ width: "100%" }} />
      </div>

      {tooShort ? (
        <>
          <div role="alert" style={S.warnCard}>
            <Icon name="alert-triangle" size={20} strokeWidth={2.2} style={{ color: "var(--warn-text)", flex: "none", marginTop: 1 }} />
            <div>
              <div style={S.warnTitle}>Too quiet or short — try again</div>
              <div style={S.warnBody}>We need at least 10 seconds of clear speech to give useful feedback.</div>
            </div>
          </div>
          <div style={S.actions}>
            <Button onClick={onReRecord} size="lg" fullWidth>Re-record</Button>
            <Button variant="secondary" size="lg" fullWidth disabled>Submit for feedback</Button>
          </div>
        </>
      ) : (
        <>
          <div style={S.actions}>
            <Button onClick={onSubmit} size="lg" fullWidth trailingIcon="arrow-right" loading={submitting} disabled={submitting}>
              Submit for feedback
            </Button>
            <Button onClick={onReRecord} variant="secondary" size="lg" fullWidth disabled={submitting}>Re-record</Button>
          </div>
          <p style={S.takeCaption}>Re-record as many times as you like — only what you submit is analyzed.</p>
        </>
      )}
      {submitError && <p style={S.submitError}>{submitError}</p>}
    </section>
  );
}

/* ── Analyzing ──────────────────────────────────────────────────────────── */
function Analyzing({ onLeave }: { onLeave: () => void }) {
  const STEPS: { label: string; state: "done" | "active" | "pending" }[] = [
    { label: "Transcribing your speech", state: "done" },
    { label: "Scoring against the band descriptors", state: "active" },
    { label: "Annotating your transcript", state: "pending" },
  ];
  return (
    <section style={{ ...S.col, alignItems: "center", padding: "16px 0" }}>
      <div style={S.analyRing}>
        <svg className="sa-spin" width={96} height={96} viewBox="0 0 96 96">
          <circle cx={48} cy={48} r={40} fill="none" stroke="var(--surface-inset)" strokeWidth={9} />
          <circle cx={48} cy={48} r={40} fill="none" stroke="var(--brand)" strokeWidth={9} strokeLinecap="round" strokeDasharray={251.2} strokeDashoffset={180} />
        </svg>
        <span style={S.analyBars} aria-hidden="true">
          <span style={{ ...S.analyBar, height: 26, background: "var(--brand)" }} />
          <span style={{ ...S.analyBar, height: 18, background: "var(--slate-400)" }} />
          <span style={{ ...S.analyBar, height: 12, background: "var(--slate-300)" }} />
        </span>
      </div>
      <div style={{ textAlign: "center" }}>
        <h2 aria-live="polite" style={S.analyH2}>Analyzing your answer</h2>
        <p style={S.analySub}>Estimating your band and marking your transcript.</p>
      </div>

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
        {STEPS.map((s) => (
          <div key={s.label} style={{ ...S.analyStep, ...(s.state === "active" ? S.analyStepActive : s.state === "pending" ? S.analyStepPending : null) }}>
            {s.state === "done" ? (
              <Icon name="circle-check" size={18} strokeWidth={2.4} style={{ color: "var(--success-text)" }} />
            ) : s.state === "active" ? (
              <span className="sa-spin" style={S.stepSpin} aria-hidden="true" />
            ) : (
              <span style={S.stepDot} aria-hidden="true" />
            )}
            <span style={{ fontSize: 14, color: s.state === "active" ? "var(--text-primary)" : "var(--text-muted)", fontWeight: s.state === "active" ? 600 : 400 }}>
              {s.label}
            </span>
          </div>
        ))}
      </div>

      <div style={S.infoCard}>
        <Icon name="info" size={20} strokeWidth={2.2} style={{ color: "var(--info)", flex: "none", marginTop: 1 }} />
        <span style={S.infoText}>You can leave — your result lands in your history when it&apos;s ready.</span>
      </div>
      <Button onClick={onLeave} variant="secondary" size="lg" fullWidth icon="arrow-left">Back to catalog</Button>
    </section>
  );
}

/* ── Gating / failure screens ──────────────────────────────────────────── */
function GateScreen({ step, onRetry, onBack }: { step: Gate; onRetry: () => void; onBack: () => void }) {
  const router = useRouter();
  const M: Record<Gate, { icon: IconName; circle: string; color: string; title: string; body: string; primary: ReactNode; secondary: ReactNode }> = {
    failed: {
      icon: "circle-x", circle: "var(--error-subtle)", color: "var(--error-text)",
      title: "We couldn't finish your analysis",
      body: "Something went wrong on our side — not yours. Your recording is safe and this attempt was not counted against your limit.",
      primary: <Button onClick={onRetry}>Try again</Button>,
      secondary: <Button variant="secondary" onClick={onBack}>Back to catalog</Button>,
    },
    preview_used: {
      icon: "sparkles", circle: "var(--brand-subtle)", color: "var(--text-link)",
      title: "That was your free Speaking analysis",
      body: "You've used your one free lifetime Speaking breakdown — it's saved in your history. Ultra unlocks unlimited Part 2 analyses.",
      primary: <Button trailingIcon="arrow-right" href="/app/upgrade">Upgrade to Ultra</Button>,
      secondary: <Button variant="ghost" onClick={() => router.push("/app/speaking/history")}>Reread my feedback</Button>,
    },
    daily_cap: {
      icon: "clock", circle: "var(--warn-subtle)", color: "var(--warn-text)",
      title: "You've hit today's Speaking limit",
      body: "You've used your daily allowance of Speaking analyses. It refreshes tomorrow — your past reports stay available.",
      primary: <Button onClick={() => router.push("/app/speaking/history")}>Open history</Button>,
      secondary: <Button variant="secondary" onClick={onBack}>Back to catalog</Button>,
    },
    in_progress: {
      icon: "clock", circle: "var(--surface-hover)", color: "var(--text-secondary)",
      title: "An analysis is already running",
      body: "Only one analysis runs at a time. Hang on for it to finish — you'll find it in your history.",
      primary: <Button onClick={() => router.push("/app/speaking/history")}>Go to history</Button>,
      secondary: <Button variant="secondary" onClick={onBack}>Back to catalog</Button>,
    },
  };
  const m = M[step];
  return (
    <section style={{ ...S.col, alignItems: "center", textAlign: "center", padding: "24px 0" }}>
      <span style={{ ...S.gateCircle, background: m.circle }}>
        <Icon name={m.icon} size={28} strokeWidth={2.2} style={{ color: m.color }} />
      </span>
      <h2 style={S.analyH2}>{m.title}</h2>
      <p style={{ ...S.analySub, maxWidth: "42ch" }}>{m.body}</p>
      <div style={S.gateBtns}>
        {m.primary}
        {m.secondary}
      </div>
    </section>
  );
}

/* Static equalizer bars (decorative, aria-hidden) — heights/delays precomputed. */
const EQ_BARS = Array.from({ length: 22 }, (_, i) => ({
  h: 26 + Math.round(Math.abs(Math.sin(i * 0.9) * 0.6 + Math.sin(i * 0.4) * 0.4) * 64),
  d: (i * 47) % 520,
}));

const CSS = `
.sa-two{display:flex;flex-direction:column;gap:18px}
@media (min-width:680px){
  .sa-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;align-items:start}
}
.sa-eqrow{display:flex;align-items:center;gap:3px;height:60px}
.sa-eqbar{flex:1;min-width:4px;border-radius:3px;background:var(--brand);transform-origin:center;animation:sa-eq .85s var(--ease-in-out) infinite alternate}
@keyframes sa-eq{from{transform:scaleY(.28)}to{transform:scaleY(1)}}
@keyframes sa-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
.sa-recdot{animation:sa-pulse 1.1s var(--ease-in-out) infinite}
@keyframes sa-spin{to{transform:rotate(360deg)}}
.sa-spin{animation:sa-spin .9s linear infinite}
@media (prefers-reduced-motion:reduce){
  .sa-eqbar{animation:none!important;transform:scaleY(.6)}
  .sa-recdot{animation:none!important}
  .sa-spin{animation-duration:2s}
}
/* iOS зумит вьюпорт при фокусе поля с font-size <16px. */
@media (max-width:430px){
  .sa-scratch{font-size:16px!important}
}
/* Close-кнопка 30×30 — визуал сохраняем, тап-зону растим псевдоэлементом (touch, не только узкий телефон). */
.sa-close{position:relative}
@media (pointer:coarse){
  .sa-close::before{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px}
}
/* Таймер+Stop уезжают под фолд ниже высокой cue-карточки (колонки стекаются на
   мобиле) — прижимаем панель к низу вьюпорта, непрозрачный фон поверх контента
   под ней, DOM-порядок не трогаем. */
@media (max-width:430px){
  .sa-recpanel{position:sticky;bottom:0;z-index:5;background:var(--bg-base);padding-top:12px;padding-bottom:calc(12px + env(safe-area-inset-bottom))}
  /* shell{overflow:hidden} — ближайший (не скроллящийся) scroll-контейнер для
     sticky-панели выше, поэтому она не липнет к вьюпорту. Открываем overflow и
     компенсируем клиппинг угла: headbar — первый ребёнок с прямыми верхними
     углами, упиравшимися в скругление shell (28px); bodyPad фона не задаёт,
     recpanel уже совпадает с фоном shell — других швов нет. */
  .sa-shell{overflow:visible!important}
  .sa-headbar{border-radius:27px 27px 0 0}
}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 960, margin: "0 auto", padding: "20px 16px 48px", fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  shell: { background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 28, overflow: "hidden", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column" },

  headbar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "14px 20px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-raised)" },
  logoBars: { display: "inline-flex", alignItems: "flex-end", gap: 2, height: 18 },
  logoBar: { width: 4, borderRadius: 2 },
  headTitle: { fontWeight: 800, fontSize: 15 },
  partPill: { marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", background: "var(--surface-inset)", border: "1px solid var(--border)", borderRadius: "var(--radius-full)", padding: "4px 10px", whiteSpace: "nowrap" },
  close: { width: 30, height: 30, display: "grid", placeItems: "center", border: "none", background: "transparent", color: "var(--text-muted)", borderRadius: "var(--radius-sm)", cursor: "pointer" },
  bodyPad: { padding: 20 },

  single: { maxWidth: 460, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  two: {},
  col: { display: "flex", flexDirection: "column", gap: 16 },

  // Cue card (full)
  cueFull: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 20, alignSelf: "start" },
  cueOver: { fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--brand)", fontWeight: 700, marginBottom: 12 },
  cuePrompt: { margin: "0 0 16px", fontSize: 18, fontWeight: 700, lineHeight: 1.3, color: "var(--text-primary)" },
  cueSay: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 },
  cueList: { listStyle: "none", margin: "0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: 8 },
  cueItem: { display: "flex", gap: 9, alignItems: "baseline", fontSize: 15, color: "var(--text-primary)" },
  cueDot: { width: 6, height: 6, borderRadius: "50%", background: "var(--brand)", flex: "none", transform: "translateY(-1px)" },
  cueClose: { fontSize: 13.5, fontStyle: "italic", color: "var(--text-muted)", borderTop: "1px dashed var(--border)", paddingTop: 12 },

  // Cue card (mini)
  cueMini: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 },
  cueMiniText: { fontSize: 14, color: "var(--text-secondary)" },

  // Prep
  ringCenter: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
  ringTime: { fontFamily: "var(--font-mono)", fontSize: 32, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" },
  ringLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginTop: 2 },
  prepHelp: { margin: 0, textAlign: "center", fontSize: 15, color: "var(--text-secondary)", maxWidth: "34ch", alignSelf: "center" },
  quietHint: { width: "100%", display: "flex", gap: 9, alignItems: "flex-start", background: "var(--surface-inset)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 12 },
  quietText: { fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 },
  scratchLabel: { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 },
  scratch: { width: "100%", minHeight: 84, resize: "vertical", background: "var(--surface-raised)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: 14, lineHeight: 1.5, border: "2px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px", outline: "none" },

  startSpin: { width: 36, height: 36, borderRadius: "50%", border: "3px solid var(--brand-border)", borderTopColor: "var(--brand)", display: "inline-block" },

  // Recording
  recCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
  recTopRow: { display: "flex", alignItems: "center", gap: 8 },
  recDot: { width: 11, height: 11, borderRadius: "50%", background: "var(--error)", flex: "none" },
  recLabel: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--error-text)" },
  recTime: { fontFamily: "var(--font-mono)", fontSize: 44, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em", lineHeight: 1 },
  srOnly: { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" },
  recRail: { height: 6, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden" },
  recFill: { height: "100%", background: "var(--brand)", borderRadius: "var(--radius-full)", transition: "width 0.25s linear" },
  recRailMeta: { display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--text-muted)" },

  meterCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  meterTop: { display: "flex", alignItems: "center", gap: 8 },
  meterStatus: { fontSize: 14, fontWeight: 600 },
  meterPeak: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" },

  stopWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 4 },
  stopBtn: { width: 76, height: 76, borderRadius: "50%", border: "none", background: "var(--error)", color: "white", boxShadow: "0 5px 0 0 var(--error-edge)", cursor: "pointer", display: "grid", placeItems: "center" },
  stopGlyph: { width: 26, height: 26, borderRadius: 7, background: "currentColor", display: "block" },
  stopLabel: { fontSize: 14, fontWeight: 700 },
  stopHint: { fontSize: 11, color: "var(--text-muted)" },

  // Stopped
  takeRow: { display: "flex", alignItems: "center", gap: 8 },
  takeTitle: { fontSize: 15, fontWeight: 700 },
  takeLen: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-secondary)" },
  playerCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "14px 16px" },
  warnCard: { display: "flex", gap: 12, alignItems: "flex-start", background: "var(--warn-subtle)", border: "1px solid color-mix(in oklab, var(--warn) 45%, transparent)", borderRadius: "var(--radius-md)", padding: "12px 16px" },
  warnTitle: { fontSize: 14, fontWeight: 700, color: "var(--warn-text)" },
  warnBody: { fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 2 },
  actions: { display: "flex", flexDirection: "column", gap: 12 },
  takeCaption: { margin: 0, textAlign: "center", fontSize: 11.5, color: "var(--text-muted)" },
  submitError: { margin: 0, textAlign: "center", fontSize: 13, fontWeight: 600, color: "var(--error-text)" },

  // Analyzing
  analyRing: { position: "relative", width: 96, height: 96, display: "grid", placeItems: "center" },
  analyBars: { position: "absolute", display: "inline-flex", alignItems: "flex-end", gap: 3, height: 26 },
  analyBar: { width: 5, borderRadius: 2 },
  analyH2: { margin: "0 0 6px", fontSize: 21, fontWeight: 800, color: "var(--text-primary)" },
  analySub: { margin: 0, fontSize: 14, color: "var(--text-secondary)", maxWidth: "32ch", lineHeight: 1.5 },
  analyStep: { display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "var(--surface-inset)", borderRadius: "var(--radius-md)" },
  analyStepActive: { background: "var(--brand-subtle)", border: "1px solid var(--brand-border)" },
  analyStepPending: { background: "transparent", opacity: 0.55 },
  stepSpin: { width: 16, height: 16, borderRadius: "50%", border: "2.4px solid var(--brand-border)", borderTopColor: "var(--brand)", display: "inline-block" },
  stepDot: { width: 16, height: 16, borderRadius: "50%", border: "2.4px solid var(--border-strong)", display: "inline-block" },
  infoCard: { width: "100%", display: "flex", gap: 12, alignItems: "flex-start", background: "var(--info-subtle)", border: "1px solid color-mix(in oklab, var(--info) 40%, transparent)", borderRadius: "var(--radius-md)", padding: 16 },
  infoText: { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 },

  // Gate
  gateCircle: { width: 76, height: 76, borderRadius: "50%", display: "grid", placeItems: "center" },
  gateBtns: { display: "flex", flexDirection: "column", gap: 10, marginTop: 8, width: "100%", maxWidth: 300, alignItems: "stretch" },
};
