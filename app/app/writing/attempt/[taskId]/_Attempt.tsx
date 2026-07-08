"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/core/Button";
import { Icon, type IconName } from "@/components/core/icons";
import { ExamTimer } from "@/components/exam/ExamTimer";
import { wordCount, wordCountState, RING_CIRC } from "@/lib/writing/word-count";
import { nextNudge, type NudgeTone } from "@/lib/writing/coach";
import { writingCategoryLabel } from "@/lib/writing/labels";
import type { CatalogTask } from "@/lib/writing/read";
import { createWritingSubmission, getSubmissionStatus } from "../../actions";

type Phase = "edit" | "queued" | "analyzing" | "failed" | "preview_used" | "daily_cap" | "in_progress";

const POLL_MS = 2500;

// Per-part shape, ring target, timer and min-word copy. Task 1 = chart description
// (overview-first, 150 words, ~20 min); Task 2 = essay (position-first, 250, ~40 min).
const STRUCTURE: { title: string; hint: string }[] = [
  { title: "Introduction", hint: "Paraphrase the prompt and state your position in one clear sentence." },
  { title: "Body 1", hint: "Your strongest reason — explain it, then prove it with one specific example." },
  { title: "Body 2", hint: "A second reason or the other side — one idea per paragraph." },
  { title: "Conclusion", hint: "Restate your position; add nothing new." },
];
const TASK1_STRUCTURE: { title: string; hint: string }[] = [
  { title: "Overview", hint: "One or two sentences on the main trend or overall pattern — no figures yet." },
  { title: "Key features", hint: "Select the most significant points and report them with accurate figures." },
  { title: "Comparisons", hint: "Group and compare — highest vs lowest, rising vs falling." },
  { title: "Accuracy check", hint: "Every number and trend must match the visual. Add nothing that isn’t shown." },
];

export function Attempt({ task, targetBand }: { task: CatalogTask; targetBand: number }) {
  const router = useRouter();
  const isTask1 = task.taskPart === "task1";
  const timerTotal = (isTask1 ? 20 : 40) * 60;
  const ringRef = isTask1 ? 150 : 250;
  const structure = isTask1 ? TASK1_STRUCTURE : STRUCTURE;

  const [phase, setPhase] = useState<Phase>("edit");
  const [essay, setEssay] = useState("");
  const [timerOn, setTimerOn] = useState(false);
  const [remaining, setRemaining] = useState(timerTotal);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const wc = wordCount(essay);
  const st = wordCountState(wc, ringRef);

  // Advisory timer — counts down while running; never auto-submits (spec: optional).
  useEffect(() => {
    if (!timerOn || phase !== "edit") return;
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [timerOn, phase]);

  // Poll the async job while queued/analyzing. Re-kick/reaper live server-side.
  useEffect(() => {
    if ((phase !== "queued" && phase !== "analyzing") || !submissionId) return;
    let alive = true;
    const id = setInterval(async () => {
      const res = await getSubmissionStatus(submissionId);
      if (!alive) return;
      if (!res || res.status === "failed") return setPhase("failed");
      if (res.status === "completed") {
        clearInterval(id);
        router.push(`/app/writing/result/${submissionId}`);
        return;
      }
      setPhase(res.status === "evaluating" ? "analyzing" : "queued");
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [phase, submissionId, router]);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await createWritingSubmission({ taskId: task.id, essay });
      if (res.ok) {
        setSubmissionId(res.submissionId);
        setPhase("queued");
        return;
      }
      switch (res.reason) {
        case "preview_used":
          return setPhase("preview_used");
        case "daily_cap":
          return setPhase("daily_cap");
        case "in_progress":
          return setPhase("in_progress");
        case "not_configured":
          return router.push("/app/practice");
        case "unavailable":
          return router.push("/app/writing");
        case "too_fast":
          return setError("Too many attempts in a row. Wait a minute and try again.");
        default:
          return setError("Please write between 20 and 1000 words.");
      }
    });
  };

  if (phase !== "edit") {
    return <FlowScreen phase={phase} onRetry={submit} onBack={() => setPhase("edit")} />;
  }

  return (
    <div className="wa-wrap" style={S.wrap}>
      <style>{CSS}</style>

      <button type="button" onClick={() => router.push("/app/writing")} style={S.back} className="wa-back">
        <Icon name="arrow-left" size={16} strokeWidth={2.5} /> Back to catalog
      </button>

      <div className="wa-grid" data-part={task.taskPart} style={S.grid}>
        {/* Left rail */}
        <div style={S.rail}>
          {isTask1 && task.imageUrl && (
            <figure style={S.chartCard}>
              <div style={S.chartOver}>The visual for this task</div>
              {/* The prompt text describes the chart; SR users get that as the text alternative. */}
              <img src={task.imageUrl} alt="Chart for this Task 1 prompt" style={S.chartImg} />
            </figure>
          )}

          <div style={S.promptCard}>
            <div style={S.promptOver}>{isTask1 ? "Task 1" : "Task 2"} · {writingCategoryLabel(task.category)}</div>
            <p style={S.promptText}>{task.prompt}</p>
            <p style={S.promptHelp}>
              {isTask1
                ? "Write at least 150 words. You have about 20 minutes."
                : "Write at least 250 words. You have about 40 minutes."}
            </p>
          </div>

          <div style={S.targetCard}>
            <div style={S.targetTop}>Aiming for</div>
            <div style={S.targetBand}>{targetBand.toFixed(1)}</div>
            <p style={S.targetHelp}>Every fix in your report points at this band.</p>
          </div>

          <div style={S.structCard}>
            <div style={S.structOver}>A solid {isTask1 ? "Task 1" : "Task 2"} shape</div>
            <div style={S.structList}>
              {structure.map((s, i) => (
                <div key={s.title} style={S.structStep}>
                  <span style={S.structNum}>{i + 1}</span>
                  <div>
                    <div style={S.structTitle}>{s.title}</div>
                    <div style={S.structHint}>{s.hint}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={S.editor}>
          <div style={S.editorHead}>
            <h1 style={S.editorTitle}>Your essay</h1>
            {timerOn ? (
              <ExamTimer remainingSeconds={remaining} totalSeconds={timerTotal} compact />
            ) : (
              <button type="button" onClick={() => setTimerOn(true)} style={S.timerBtn} className="wa-timer">
                <Icon name="clock" size={16} strokeWidth={2.4} /> Start {isTask1 ? 20 : 40}-min timer
              </button>
            )}
          </div>
          <div className="wa-editmain">
            <textarea
              value={essay}
              onChange={(e) => setEssay(e.target.value)}
              placeholder="Start writing your response…"
              style={S.textarea}
              aria-label="Your essay"
            />
            <div className="wa-coach">
              <CoachTip text={essay} taskPart={task.taskPart} />
            </div>
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="wa-actionbar" style={S.actionBar}>
        <div style={S.ringRow}>
          <WordRing count={wc} state={st} />
          <div>
            <div style={{ ...S.ringStatus, color: st.color }}>{st.message}</div>
            <div style={S.ringMeta}>words · min 20 · max 1000</div>
          </div>
        </div>
        <div style={S.actionRight}>
          <Button size="lg" trailingIcon="arrow-right" disabled={!st.canSubmit || pending} loading={pending} onClick={submit}>
            Get my feedback
          </Button>
          <div style={S.disclaimer}>
            {error ?? "Estimated band range — not an official IELTS score."}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Word-count ring (r=44, stroke 9; rendered ~62px) ────────────────────── */
function WordRing({ count, state }: { count: number; state: ReturnType<typeof wordCountState> }) {
  return (
    <svg width={62} height={62} viewBox="0 0 100 100" style={{ flex: "none" }} aria-hidden="true">
      <circle cx={50} cy={50} r={44} fill="none" stroke="var(--surface-inset)" strokeWidth={9} />
      <circle
        cx={50}
        cy={50}
        r={44}
        fill="none"
        stroke={state.color}
        strokeWidth={9}
        strokeLinecap="round"
        strokeDasharray={RING_CIRC}
        strokeDashoffset={state.offset}
        transform="rotate(-90 50 50)"
        style={{ transition: "stroke-dashoffset var(--duration-base) var(--ease-standard), stroke var(--duration-base) var(--ease-standard)" }}
      />
      <text x={50} y={50} textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-mono)" fontSize={28} fontWeight={600} fill="var(--text-primary)">
        {count}
      </text>
    </svg>
  );
}

/* ── Live coach tip ───────────────────────────────────────────────────────
   ONE deterministic nudge derived from the draft (nextNudge). UI flavour only —
   never a band or score. Animations replay only when the nudge id changes
   (key-on-id remount); the card colour transitions in place. */
const TONES: Record<NudgeTone, { bg: string; border: string; iconBg: string; accent: string; title: string }> = {
  purple: {
    bg: "var(--brand-subtle)",
    border: "var(--brand-border)",
    iconBg: "color-mix(in oklab, var(--brand) 16%, var(--surface))",
    accent: "var(--brand)",
    title: "var(--text-link)",
  },
  amber: {
    bg: "var(--warn-subtle)",
    border: "color-mix(in oklab, var(--warn) 38%, var(--surface))",
    iconBg: "color-mix(in oklab, var(--warn) 22%, var(--surface))",
    accent: "var(--warn)",
    title: "var(--warn-text)",
  },
  green: {
    bg: "var(--success-subtle)",
    border: "color-mix(in oklab, var(--success) 34%, var(--surface))",
    iconBg: "color-mix(in oklab, var(--success) 20%, var(--surface))",
    accent: "var(--success)",
    title: "var(--success-text)",
  },
};

function CoachTip({ text, taskPart }: { text: string; taskPart: "task1" | "task2" }) {
  const nudge = nextNudge(text, taskPart);
  const tone = TONES[nudge.tone];
  // The green tone IS the celebratory "ready" state for both parts (Task 2 "ready",
  // Task 1 "t1_ready") — gate on tone, not the namespaced id.
  const ready = nudge.tone === "green";
  return (
    <div
      className="ct-card"
      data-ready={ready}
      style={{ ...S.ctCard, background: tone.bg, borderColor: tone.border }}
      role="status"
      aria-live="polite"
    >
      <span key={`bar-${nudge.id}`} className="ct-bar" style={{ ...S.ctBar, background: tone.accent }} aria-hidden="true" />
      <div key={`body-${nudge.id}`} className="ct-body" style={S.ctBody}>
        <span className="ct-iconwrap" style={S.ctIconWrap} aria-hidden="true">
          <span className="ct-icon" style={{ ...S.ctIcon, background: tone.iconBg }}>{nudge.icon}</span>
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...S.ctTitle, color: tone.title }}>{nudge.title}</div>
          <div style={S.ctText}>{nudge.body}</div>
          <span className="ct-chip" style={{ ...S.ctChip, background: tone.iconBg, color: tone.title }}>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5" />
              <path d="M6 11l6-6 6 6" />
            </svg>
            {nudge.criterion}
          </span>
        </div>
      </div>
      {ready && (
        <>
          <span key={`spark1-${nudge.id}`} className="ct-spark1" style={S.ctSpark1} aria-hidden="true">✨</span>
          <span key={`spark2-${nudge.id}`} className="ct-spark2" style={S.ctSpark2} aria-hidden="true">✦</span>
        </>
      )}
    </div>
  );
}

/* ── Async / gating screens (queue, analyzing, failed, preview, cap) ──────── */
function FlowScreen({ phase, onRetry, onBack }: { phase: Phase; onRetry: () => void; onBack: () => void }) {
  const router = useRouter();
  return (
    <div style={S.centerWrap}>
      <style>{FLOW_CSS}</style>
      {phase === "queued" && (
        <div style={S.centerCard}>
          <div style={S.dots} aria-hidden="true">
            <span style={S.dot} className="wl-dot1" />
            <span style={S.dot} className="wl-dot2" />
            <span style={S.dot} className="wl-dot3" />
          </div>
          <h1 style={S.centerH1}>You&apos;re in the queue</h1>
          <p style={S.centerMono}>Holding your spot · est. wait a few seconds</p>
          <StatusList active="queued" />
          <p style={S.centerFoot}>You can leave this page — we&apos;ll keep your spot. Only one analysis runs at a time.</p>
        </div>
      )}

      {phase === "analyzing" && (
        <div style={S.centerCard}>
          <LivingLogo />
          <h1 style={S.centerH1}>Analyzing your essay…</h1>
          <p style={S.centerMono}>Usually 10–40 seconds</p>
          <div style={S.indetRail} aria-hidden="true">
            <span style={S.indetFill} className="wl-bar" />
          </div>
          <StatusList active="analyzing" />
        </div>
      )}

      {phase === "failed" && (
        <CenteredState
          icon="circle-x"
          circle="var(--error-subtle)"
          iconColor="var(--error-text)"
          title="We couldn't finish your analysis"
          body="Something went wrong on our side — not yours. Your essay is safe, and this attempt was not counted against your limit."
        >
          <Button onClick={onRetry}>Try analysis again</Button>
          <Button variant="secondary" onClick={onBack}>Back to my essay</Button>
        </CenteredState>
      )}

      {phase === "preview_used" && (
        <CenteredState
          icon="sparkles"
          circle="var(--brand-subtle)"
          iconColor="var(--text-link)"
          title="That was your free analysis — nice start"
          body="You've used your one free lifetime breakdown — and it's saved, so reread it any time. Premium unlocks daily Task 2 analyses with your real band."
        >
          <div style={S.perks}>
            {["Up to 5 essay analyses every day", "A model rewrite of every weak paragraph", "Your full attempt history"].map((p) => (
              <div key={p} style={S.perk}>
                <Icon name="check" size={16} strokeWidth={2.6} style={{ color: "var(--success-text)" }} /> {p}
              </div>
            ))}
          </div>
          <Button trailingIcon="arrow-right" href="/app/upgrade">Upgrade to Premium</Button>
          <Button variant="ghost" onClick={() => router.push("/app/writing/history")}>Reread my feedback</Button>
        </CenteredState>
      )}

      {phase === "daily_cap" && (
        <CenteredState
          icon="clock"
          circle="var(--warn-subtle)"
          iconColor="var(--warn-text)"
          title="You've hit today's analysis limit"
          body="You've used your generous daily allowance of essay analyses. It refreshes tomorrow — your past reports stay available."
        >
          <Button onClick={() => router.push("/app/writing/history")}>Review last feedback</Button>
          <Button variant="secondary" onClick={() => router.push("/app/writing/history")}>Open history</Button>
        </CenteredState>
      )}

      {phase === "in_progress" && (
        <CenteredState
          icon="clock"
          circle="var(--surface-hover)"
          iconColor="var(--text-secondary)"
          title="An analysis is already running"
          body="Only one analysis runs at a time. Hang on for it to finish — you'll find it in your history."
        >
          <Button onClick={() => router.push("/app/writing/history")}>Go to history</Button>
          <Button variant="secondary" onClick={onBack}>Back to my essay</Button>
        </CenteredState>
      )}
    </div>
  );
}

function StatusList({ active }: { active: "queued" | "analyzing" }) {
  const steps: { key: string; label: string }[] = [
    { key: "queued", label: "Queued" },
    { key: "analyzing", label: "Analyzing" },
    { key: "building", label: "Building your report" },
  ];
  const order = ["queued", "analyzing", "building"];
  const activeIdx = order.indexOf(active);
  return (
    <div style={S.statusList}>
      {steps.map((s, i) => {
        const done = i < activeIdx;
        const isActive = i === activeIdx;
        return (
          <div key={s.key} style={S.statusItem}>
            <span
              style={{
                ...S.statusDot,
                background: done ? "var(--success)" : isActive ? "var(--brand)" : "var(--surface-inset)",
                color: done ? "white" : "transparent",
                boxShadow: isActive ? "0 0 0 4px var(--brand-subtle)" : "none",
              }}
            >
              {done && <Icon name="check" size={12} strokeWidth={3} />}
            </span>
            <span style={{ ...S.statusLabel, color: done || isActive ? "var(--text-primary)" : "var(--text-muted)" }}>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LivingLogo() {
  return (
    <div style={S.logoWrap} aria-hidden="true">
      <div style={S.logoBars} className="wl-levitate">
        <span style={{ ...S.logoBar, width: "100%", background: "var(--brand)" }}>
          <span style={S.sheen} className="wl-sheen" />
        </span>
        <span style={{ ...S.logoBar, width: "78%", background: "var(--violet-300)" }} />
        <span style={{ ...S.logoBar, width: "56%", background: "var(--violet-200)" }} />
      </div>
    </div>
  );
}

function CenteredState({
  icon,
  circle,
  iconColor,
  title,
  body,
  children,
}: {
  icon: IconName;
  circle: string;
  iconColor: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div style={S.centerCard}>
      <span style={{ ...S.stateCircle, background: circle }} className="wl-pop">
        <Icon name={icon} size={30} strokeWidth={2.2} style={{ color: iconColor }} />
      </span>
      <h1 style={S.centerH1}>{title}</h1>
      <p style={S.centerBody}>{body}</p>
      <div style={S.stateBtns}>{children}</div>
    </div>
  );
}

const CSS = `
.wa-wrap{padding:20px 16px 40px}
.wa-grid{display:grid;grid-template-columns:1fr;gap:18px;align-items:start}
/* Sticky, пока рейл (chart/prompt/target/structure) стоит ПЕРЕД editor в потоке —
   без этого счётчик слов и Submit уходят за фолд под открытой клавиатурой. Тот же
   приём, что у .sa-recpanel в Speaking _Attempt.tsx. padding живёт целиком тут (не в
   инлайне) — иначе inline style={S.actionBar} перебивает safe-area-паддинг снизу. */
.wa-actionbar{flex-direction:column;gap:16px;align-items:stretch;padding:18px;position:sticky;bottom:0;z-index:5;padding-bottom:calc(18px + env(safe-area-inset-bottom))}
.wa-back:hover{color:var(--text-primary)!important}
.wa-timer:hover{background:var(--surface-hover)!important}
/* Editor body: textarea + coach stacked on narrow/tablet, side-by-side on wide
   (gated at 1024 so the textarea never gets cramped in the 880–1023 zone). */
.wa-editmain{display:flex;flex-direction:column;gap:12px;min-width:0}
.wa-coach{width:100%}
@media (min-width:880px){
  .wa-wrap{padding:24px 28px 56px}
  .wa-grid{grid-template-columns:280px 1fr}
  /* Task 1: keep the chart full-width above the editor on tablet — a 280px chart is
     too cramped to read; it splits only once there's room (≥1024). */
  .wa-grid[data-part="task1"]{grid-template-columns:1fr}
  .wa-actionbar{flex-direction:row;align-items:center;justify-content:space-between}
  /* Task 2 здесь уже двухколоночный (рейл — сайдбар) — экшнбар в зоне видимости,
     sticky не нужен. Task 1 остаётся одноколоночным до 1024px (см. ниже) — там
     рейл всё ещё стоит перед editor, sticky должен работать и здесь. */
  .wa-grid:not([data-part="task1"]) .wa-actionbar{position:static;padding-bottom:18px}
}
@media (min-width:1024px){
  .wa-editmain{flex-direction:row;align-items:flex-start;gap:14px}
  .wa-coach{width:280px;flex:none;position:sticky;top:88px}
  /* Task 1 split: chart-left / field-right. The editor column is narrower, so keep
     its coach stacked under the textarea (no 280px sidebar that would cramp it). */
  .wa-grid[data-part="task1"]{grid-template-columns:minmax(340px,1fr) 1fr;gap:22px}
  .wa-grid[data-part="task1"] .wa-editmain{flex-direction:column}
  .wa-grid[data-part="task1"] .wa-coach{width:100%;position:static}
  /* Task 1 наконец разбился на 2 колонки — рейл больше не стоит перед editor. */
  .wa-grid[data-part="task1"] .wa-actionbar{position:static;padding-bottom:18px}
}
/* Coach tip — colour morphs in place; entry/float/glow/spark are motion-gated. */
.ct-card{transition:background .35s ease,border-color .35s ease}
@keyframes ct-tipIn{from{opacity:0;transform:translateY(11px) scale(.985)}to{opacity:1;transform:none}}
@keyframes ct-iconPop{0%{opacity:0;transform:scale(.3) rotate(-22deg)}55%{opacity:1;transform:scale(1.22) rotate(9deg)}100%{transform:scale(1) rotate(0)}}
@keyframes ct-floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes ct-barWipe{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes ct-chipIn{from{opacity:0;transform:translateX(-7px)}to{opacity:1;transform:none}}
@keyframes ct-glow{0%,100%{box-shadow:0 8px 22px -12px transparent}50%{box-shadow:0 10px 30px -8px color-mix(in oklab, var(--success) 45%, transparent)}}
@keyframes ct-spark{0%{opacity:0;transform:scale(0) translateY(0)}40%{opacity:1;transform:scale(1.15) translateY(-6px)}100%{opacity:0;transform:scale(.5) translateY(-18px)}}
@media (prefers-reduced-motion:no-preference){
  .ct-body{animation:ct-tipIn .42s cubic-bezier(.2,.8,.3,1) both}
  .ct-bar{animation:ct-barWipe .5s cubic-bezier(.2,.8,.3,1) both}
  .ct-iconwrap{animation:ct-floaty 3.2s ease-in-out .5s infinite}
  .ct-icon{animation:ct-iconPop .5s cubic-bezier(.3,1.4,.5,1) both}
  .ct-chip{animation:ct-chipIn .4s .16s ease both}
  .ct-card[data-ready="true"]{animation:ct-glow 2.2s ease-in-out infinite}
  .ct-spark1{animation:ct-spark .9s ease-out both}
  .ct-spark2{animation:ct-spark 1.1s ease-out .15s both}
}
/* Тап-таргеты ≥44px на touch: "Back to catalog" (padding:4) и таймер (height:40). */
@media (pointer:coarse){
  .wa-back{min-height:44px}
  .wa-timer{min-height:44px}
}
@media (max-width:430px){
  /* Криterion-чип в live-коуче — смысловой uppercase-лейбл, 12px. */
  .ct-chip{font-size:12px!important}
}
`;

const FLOW_CSS = `
@keyframes wl-bar{0%{left:-40%}100%{left:100%}}
@keyframes wl-levitate{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes wl-sheen{0%{transform:translateX(-130%)}55%,100%{transform:translateX(320%)}}
@keyframes wl-pulse{0%,100%{opacity:.3;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
@keyframes wl-pop{0%{transform:scale(.92)}60%{transform:scale(1.04)}100%{transform:scale(1)}}
.wl-dot1{animation:wl-pulse 1.2s var(--ease-in-out) infinite}
.wl-dot2{animation:wl-pulse 1.2s var(--ease-in-out) .2s infinite}
.wl-dot3{animation:wl-pulse 1.2s var(--ease-in-out) .4s infinite}
.wl-bar{animation:wl-bar 1.1s var(--ease-in-out) infinite}
.wl-levitate{animation:wl-levitate 3s var(--ease-in-out) infinite}
.wl-sheen{animation:wl-sheen 2.6s var(--ease-in-out) infinite}
.wl-pop{animation:wl-pop .5s var(--ease-spring)}
@media (prefers-reduced-motion:reduce){
  .wl-dot1,.wl-dot2,.wl-dot3,.wl-bar,.wl-levitate,.wl-sheen,.wl-pop{animation:none!important}
}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 1520, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  back: { display: "inline-flex", alignItems: "center", gap: 7, alignSelf: "flex-start", border: "none", background: "transparent", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", padding: 4, transition: "var(--transition-colors)" },

  grid: {},
  rail: { display: "flex", flexDirection: "column", gap: 14 },
  // Task 1 chart: white-backed so the (light) chart stays legible on any theme.
  chartCard: { margin: 0, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 14, display: "flex", flexDirection: "column", gap: 10 },
  chartOver: { fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-link)" },
  chartImg: { width: "100%", height: "auto", display: "block", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "white" },
  promptCard: { background: "var(--brand-subtle)", border: "2px solid var(--brand-border)", borderRadius: "var(--radius-lg)", padding: 18 },
  promptOver: { fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-link)", marginBottom: 8 },
  promptText: { margin: 0, fontSize: 16, lineHeight: 1.5, fontWeight: 500, color: "var(--text-primary)" },
  promptHelp: { margin: "10px 0 0", fontSize: 13, color: "var(--text-secondary)" },

  targetCard: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 18 },
  targetTop: { fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)" },
  targetBand: { fontFamily: "var(--font-mono)", fontSize: 34, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.1, marginTop: 4 },
  targetHelp: { margin: "8px 0 0", fontSize: 13, color: "var(--text-secondary)" },

  structCard: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 18 },
  structOver: { fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 14 },
  structList: { display: "flex", flexDirection: "column", gap: 14 },
  structStep: { display: "flex", gap: 12, alignItems: "flex-start" },
  structNum: { flex: "none", width: 26, height: 26, borderRadius: "var(--radius-full)", background: "var(--brand-subtle)", color: "var(--text-link)", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, display: "grid", placeItems: "center" },
  structTitle: { fontSize: 14, fontWeight: 700, color: "var(--text-primary)" },
  structHint: { fontSize: 12.5, lineHeight: 1.45, color: "var(--text-muted)", marginTop: 2 },

  editor: { display: "flex", flexDirection: "column", gap: 12, minHeight: 0 },
  editorHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  editorTitle: { margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text-primary)" },
  timerBtn: { display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 14px", borderRadius: "var(--radius-full)", border: "2px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "var(--transition-colors)" },
  textarea: { flex: 1, minHeight: "clamp(560px, 68vh, 820px)", width: "100%", resize: "vertical", background: "var(--reading-surface)", color: "var(--reading-text)", fontFamily: "var(--font-reading)", fontSize: 17, lineHeight: 1.7, border: "2px solid var(--border)", borderRadius: 18, boxShadow: "var(--shadow-solid)", padding: "18px 20px", outline: "none" },

  // Live coach tip
  ctCard: { position: "relative", overflow: "hidden", borderRadius: 16, borderWidth: 1, borderStyle: "solid", padding: "15px 17px" },
  ctBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, transformOrigin: "left" },
  ctBody: { display: "flex", gap: 12, alignItems: "flex-start", paddingLeft: 4 },
  ctIconWrap: { flexShrink: 0 },
  ctIcon: { display: "flex", width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", fontSize: 16 },
  ctTitle: { fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13, marginBottom: 3 },
  ctText: { fontFamily: "var(--font-ui)", fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" },
  ctChip: { display: "inline-flex", alignItems: "center", gap: 5, marginTop: 9, borderRadius: 99, padding: "3px 9px", fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" },
  ctSpark1: { position: "absolute", right: 16, top: 12, fontSize: 14, pointerEvents: "none" },
  ctSpark2: { position: "absolute", right: 30, top: 22, fontSize: 10, pointerEvents: "none" },

  actionBar: { display: "flex", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: 18, boxShadow: "var(--shadow-solid)" },
  ringRow: { display: "flex", alignItems: "center", gap: 16 },
  ringStatus: { fontSize: 15, fontWeight: 700 },
  ringMeta: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", marginTop: 2 },
  actionRight: { display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8 },
  disclaimer: { fontSize: 12, color: "var(--text-muted)", textAlign: "center", maxWidth: 280 },

  // Centered flow / gating screens
  centerWrap: { maxWidth: 560, margin: "0 auto", padding: "48px 18px 64px", display: "flex", justifyContent: "center", fontFamily: "var(--font-ui)" },
  centerCard: { width: "100%", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" },
  centerH1: { margin: "20px 0 0", fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)", textWrap: "balance" },
  centerMono: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)", marginTop: 8 },
  centerBody: { fontSize: 15, lineHeight: 1.55, color: "var(--text-secondary)", margin: "12px 0 0", maxWidth: "44ch" },
  centerFoot: { fontSize: 13, lineHeight: 1.5, color: "var(--text-muted)", margin: "20px 0 0", maxWidth: "42ch" },

  dots: { display: "flex", gap: 10, padding: 18, borderRadius: "var(--radius-full)", background: "var(--surface-hover)" },
  dot: { width: 12, height: 12, borderRadius: "var(--radius-full)", background: "var(--brand)" },

  indetRail: { position: "relative", height: 6, width: "100%", maxWidth: 320, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden", margin: "20px 0 0" },
  indetFill: { position: "absolute", top: 0, bottom: 0, width: "40%", borderRadius: "var(--radius-full)", background: "var(--brand)" },

  statusList: { display: "flex", flexDirection: "column", gap: 12, marginTop: 26, padding: "18px 20px", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", textAlign: "left", width: "100%", maxWidth: 340 },
  statusItem: { display: "flex", alignItems: "center", gap: 12 },
  statusDot: { flex: "none", width: 22, height: 22, borderRadius: "var(--radius-full)", display: "grid", placeItems: "center" },
  statusLabel: { fontSize: 14, fontWeight: 600 },

  logoWrap: { display: "grid", placeItems: "center", padding: 8 },
  logoBars: { display: "flex", flexDirection: "column", gap: 9, width: 92 },
  logoBar: { position: "relative", height: 16, borderRadius: "var(--radius-full)", overflow: "hidden" },
  sheen: { position: "absolute", top: 0, bottom: 0, width: "40%", background: "linear-gradient(90deg, transparent, color-mix(in oklab, white 70%, transparent), transparent)" },

  stateCircle: { width: 76, height: 76, borderRadius: "var(--radius-full)", display: "grid", placeItems: "center" },
  stateBtns: { display: "flex", flexDirection: "column", gap: 10, marginTop: 24, width: "100%", maxWidth: 300, alignItems: "stretch" },
  perks: { display: "flex", flexDirection: "column", gap: 10, margin: "22px 0 0", padding: "16px 18px", background: "var(--surface)", border: "2px solid var(--brand-border)", borderRadius: "var(--radius-lg)", textAlign: "left", width: "100%", maxWidth: 340 },
  perk: { display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" },
};
