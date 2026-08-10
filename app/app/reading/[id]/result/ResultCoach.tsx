"use client";

/**
 * ResultCoach — tabbed "coach" concept for /result (replaces the chapter-based
 * Debrief): a hero verdict, three tabs (Review misses / By type / Answer key)
 * and a fixed action dock. Port of result-coach.html onto bando tokens.
 *
 * Invariant: content is visible without JS from the first paint — the default
 * active tab (Review) is what the server renders; tab switching, the bar/dial
 * draw-ins and toasts are WAAPI/rAF layered on top of an already-correct DOM,
 * and are skipped entirely under prefers-reduced-motion (same contract as
 * reveal.tsx/InsightReport.tsx). All data is pre-computed server-side
 * (page.tsx) — this component only renders it.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Button } from "@/components/core/Button";
import { categoryLabel } from "@/lib/labels";
import type { DebriefData } from "@/lib/result/debrief";
import BadgeUnlock from "./BadgeUnlock";
import { ShareResult } from "./ShareResult";
import { Dial, FadeUp } from "./reveal";
import { AnswerKeyFilter, type AKItem, type AKType } from "./InsightReport";

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

function prefersReduced(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const barColor = (ratio: number) => (ratio >= 0.6 ? "var(--success)" : ratio > 0 ? "var(--warn)" : "var(--error)");

type TabKey = "review" | "types" | "key";

// Полный ARIA-tablist паттерн (roving tabindex + id/aria-controls/
// aria-labelledby): "key"-панель обязана сохранить id="answer-key" — на него
// завязан #answer-key deep-link (см. useEffect в ResultCoach).
const TAB_ORDER: TabKey[] = ["review", "types", "key"];
const TAB_META: Record<TabKey, { tabId: string; panelId: string }> = {
  review: { tabId: "rc-tab-review", panelId: "rc-panel-review" },
  types: { tabId: "rc-tab-types", panelId: "rc-panel-types" },
  key: { tabId: "rc-tab-key", panelId: "answer-key" },
};

interface UnlockedBadge {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
}

export default function ResultCoach({
  data,
  akItems,
  akTypes,
  unlockedBadges,
}: {
  data: DebriefData;
  akItems: AKItem[];
  akTypes: AKType[];
  unlockedBadges: UnlockedBadge[];
}) {
  const [tab, setTab] = useState<TabKey>("review");
  // Дефолт "wrong", а не "all" — экран построен вокруг промахов (прототип
  // result-coach.html:484 тоже стартует с active="wrong"). Пустой экран
  // возможен только при 0 промахов — тогда дефолт остаётся "all".
  const [akFilter, setAkFilter] = useState(() => (data.missed.length > 0 ? "wrong" : "all"));
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tabsRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Partial<Record<TabKey, HTMLElement | null>>>({});
  // Бейдж таба Review = куратированный replay (см. page.tsx), а не общее
  // число промахов — за исключением гейта (replay пуст, но Review-панель
  // всё равно показывает полный список missed-чипов + upsell).
  const reviewBadgeCount = data.replay.length > 0 ? data.replay.length : data.missed.length;

  const showToast = (msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2400);
  };

  // Deep-link into the answer key (e.g. shared /result#answer-key) opens
  // straight into that tab instead of the Review-misses default — then
  // scrolls there once the panel is actually visible (rAF: the display:none →
  // block flip from setTab hasn't painted yet in this same tick).
  useEffect(() => {
    if (window.location.hash !== "#answer-key") return;
    setTab("key");
    requestAnimationFrame(() => {
      document.getElementById("answer-key")?.scrollIntoView({ behavior: prefersReduced() ? "auto" : "smooth", block: "start" });
    });
  }, []);

  // The panel's visible/hidden state is already correct via the `hide` class
  // before this runs (SSR-final) — this only layers a reveal on top of it,
  // and is skipped under reduced motion.
  useEffect(() => {
    if (prefersReduced()) return;
    const el = panelRefs.current[tab];
    el?.animate(
      [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }],
      { duration: 350, easing: EASE_OUT, fill: "backwards" },
    );
  }, [tab]);

  const goTab = (t: TabKey) => setTab(t);
  // Roving tabindex + стрелочная навигация (полный ARIA-tablist паттерн):
  // ArrowLeft/Right крутят по кругу, Home/End — к первому/последнему табу;
  // фокус переносится явно (roving tabindex сам по себе не двигает фокус браузера).
  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TAB_ORDER.indexOf(tab);
    let next: TabKey | null = null;
    if (e.key === "ArrowRight") next = TAB_ORDER[(i + 1) % TAB_ORDER.length];
    else if (e.key === "ArrowLeft") next = TAB_ORDER[(i - 1 + TAB_ORDER.length) % TAB_ORDER.length];
    else if (e.key === "Home") next = TAB_ORDER[0];
    else if (e.key === "End") next = TAB_ORDER[TAB_ORDER.length - 1];
    if (!next) return;
    e.preventDefault();
    goTab(next);
    document.getElementById(TAB_META[next].tabId)?.focus();
  };
  const scrollToTabs = () => tabsRef.current?.scrollIntoView({ behavior: prefersReduced() ? "auto" : "smooth", block: "start" });
  const scrollToDock = () => dockRef.current?.scrollIntoView({ behavior: prefersReduced() ? "auto" : "smooth", block: "center" });
  const jumpToType = (type: string) => {
    setAkFilter(type);
    goTab("key");
    scrollToTabs();
  };

  return (
    <div>
      <style>{COACH_CSS}</style>

      <Hero data={data} onReview={() => goTab("review")} onTypes={() => goTab("types")} />

      {unlockedBadges.length > 0 && (
        <div style={{ margin: "14px 0" }}>
          <BadgeUnlock badges={unlockedBadges} />
        </div>
      )}

      <div className="rc-tabs" ref={tabsRef}>
        <div className="rc-seg" role="tablist" aria-label="Result sections">
          <button
            type="button"
            role="tab"
            id={TAB_META.review.tabId}
            aria-selected={tab === "review"}
            aria-controls={TAB_META.review.panelId}
            tabIndex={tab === "review" ? 0 : -1}
            className={`rc-tab${tab === "review" ? " on" : ""}`}
            onClick={() => goTab("review")}
            onKeyDown={onTabKeyDown}
          >
            🎯 Review misses <span className="rc-b">{reviewBadgeCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            id={TAB_META.types.tabId}
            aria-selected={tab === "types"}
            aria-controls={TAB_META.types.panelId}
            tabIndex={tab === "types" ? 0 : -1}
            className={`rc-tab${tab === "types" ? " on" : ""}`}
            onClick={() => goTab("types")}
            onKeyDown={onTabKeyDown}
          >
            📊 By type
          </button>
          <button
            type="button"
            role="tab"
            id={TAB_META.key.tabId}
            aria-selected={tab === "key"}
            aria-controls={TAB_META.key.panelId}
            tabIndex={tab === "key" ? 0 : -1}
            className={`rc-tab${tab === "key" ? " on" : ""}`}
            onClick={() => goTab("key")}
            onKeyDown={onTabKeyDown}
          >
            📋 Answer key <span className="rc-b">{data.totalQuestions}</span>
          </button>
        </div>
      </div>

      <section
        role="tabpanel"
        id={TAB_META.review.panelId}
        aria-labelledby={TAB_META.review.tabId}
        className={`rc-panel${tab === "review" ? "" : " hide"}`}
        ref={(el) => { panelRefs.current.review = el; }}
      >
        <ReviewRoom data={data} onSkipToKey={() => goTab("key")} showToast={showToast} scrollToDock={scrollToDock} />
        <p className="rc-hint">Active recall beats re-reading. Answer first — <b>then</b> see the proof from the passage.</p>
      </section>

      <section
        role="tabpanel"
        id={TAB_META.types.panelId}
        aria-labelledby={TAB_META.types.tabId}
        className={`rc-panel${tab === "types" ? "" : " hide"}`}
        ref={(el) => { panelRefs.current.types = el; }}
      >
        <ByType level={data.level} totalQuestions={data.totalQuestions} active={tab === "types"} onFocus={jumpToType} />
      </section>

      <section
        id={TAB_META.key.panelId}
        role="tabpanel"
        aria-labelledby={TAB_META.key.tabId}
        className={`rc-panel${tab === "key" ? "" : " hide"}`}
        ref={(el) => { panelRefs.current.key = el; }}
      >
        <AnswerKeyFilter items={akItems} types={akTypes} filter={akFilter} onFilterChange={setAkFilter} />
      </section>

      <Dock data={data} dockRef={dockRef} />

      <div className={`rc-toast${toastMsg ? " show" : ""}`} role="status" aria-live="polite">
        {toastMsg}
      </div>
    </div>
  );
}

/* ============================================================ Hero (verdict) */

function Hero({ data, onReview, onTypes }: { data: DebriefData; onReview: () => void; onTypes: () => void }) {
  const { score } = data;
  const pct = Math.round(score.correctPct * 100);
  const bandValue = score.banded && score.band != null ? score.band : null;

  return (
    <section className="rc-verdict">
      <div className="rc-vd-in">
        <div className="rc-vd-meta">
          Your result · <b>{data.title}</b>
          {data.category ? ` · ${categoryLabel(data.category)}` : ""} · {data.totalQuestions} questions
        </div>
        <div className="rc-vd-grid">
          <div>
            <Dial pct={score.correctPct} center={bandValue != null ? { kind: "band", value: bandValue } : { kind: "pct", value: pct }} />
            {/* Non-banded (kind==="pct"): диал уже показывает pct% в центре —
                этот блок повторял бы тот же процент рядом. Показываем только
                когда центр = band, тогда pct% здесь не дублирует, а дополняет. */}
            {bandValue != null && (
              <div className="rc-vd-score">
                <span className="p">{pct}%</span>
                <span className="s">{score.raw} / {score.total} correct</span>
              </div>
            )}
          </div>
          <div className="rc-vd-rule" />
          <div>
            <BlindSpotCopy blindSpot={data.blindSpot} />
            <div className="rc-vd-actions">
              <Button onClick={onReview}>Review my misses →</Button>
              <Button variant="secondary" onClick={onTypes}>See where I stand</Button>
              {data.share && <ShareResult refCode={data.share.refCode} headline={data.share.headline} variant="secondary" fullWidth={false} />}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BlindSpotCopy({ blindSpot }: { blindSpot: DebriefData["blindSpot"] }) {
  if (!blindSpot) {
    return (
      <>
        <div className="rc-vd-ey">Nothing left to fix</div>
        <h2 className="rc-vd-h">You cleared every question.</h2>
        <p className="rc-vd-p">There&rsquo;s no blind spot to chase this time — carry the habit into your next attempt and keep the streak going.</p>
      </>
    );
  }
  const { label, weakBucket, strongBucket, costMarks } = blindSpot;
  const isNg = label === "Not Given";
  const marks = `${costMarks} mark${costMarks === 1 ? "" : "s"}`;

  return (
    <>
      <div className="rc-vd-ey">The one thing to fix</div>
      <h2 className="rc-vd-h">
        <em>{label}</em> {strongBucket ? "is quietly stealing your marks." : "is where you're losing the most marks."}
      </h2>
      <p className="rc-vd-p">
        {strongBucket ? (
          isNg ? (
            <>When the text clearly states an answer, you get it (<b>{strongBucket.correct}/{strongBucket.total}</b>). But when it says nothing, you guess — and that guess costs you. That one habit cost you <b>{marks}</b> today.</>
          ) : (
            <>You&rsquo;re sharp at spotting when nothing is stated (<b>{strongBucket.correct}/{strongBucket.total}</b>). But when the text DOES give a clear answer, you&rsquo;re missing it — that cost you <b>{marks}</b> today.</>
          )
        ) : (
          <>You get {weakBucket.correct} of {weakBucket.total} right here — the rest of your answers average much higher. Fixing just this type is the fastest points on the board.</>
        )}
      </p>
    </>
  );
}

/* ======================================================= Review Room (S3) */
/* Guided replay: пропущенные вопросы по одному, "без таймера". Re-pick
   интерактивен только для tfng/ynng (options != null); прочие типы сразу
   получают reveal-only "Recall it… then reveal →". При гейте (replayLocked)
   answer/why/evidence не сериализуются вовсе — показываем безопасный список
   Q-номеров/типов + апселл. */

function ReviewRoom({
  data,
  onSkipToKey,
  showToast,
  scrollToDock,
}: {
  data: DebriefData;
  onSkipToKey: () => void;
  showToast: (msg: string) => void;
  scrollToDock: () => void;
}) {
  const [gi, setGi] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [pickedOpt, setPickedOpt] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  if (data.missed.length === 0) {
    return (
      <div className="rc-rr">
        <p className="rc-rr-perfect">Perfect run — nothing to replay. 🎉</p>
      </div>
    );
  }

  if (data.replayLocked || data.replay.length === 0) {
    return (
      <div className="rc-rr">
        <p className="rc-rr-lead">
          You missed {data.missed.length} question{data.missed.length === 1 ? "" : "s"} — replay them below.
        </p>
        <div className="rc-rr-chips">
          {data.missed.map((m) => (
            <span className="rc-rr-chip" key={m.number}>Q{m.number} · {m.label}</span>
          ))}
        </div>
        {data.replayLocked && (
          <div className="rc-upsell">
            <div className="rc-upsell-title">See the answers and why</div>
            <p className="rc-upsell-text">
              You can see which questions you missed. Premium reveals the correct answers, the
              explanation behind each, and the exact text evidence.
            </p>
            <Button href="/app/upgrade" trailingIcon="arrow-right">Go Premium</Button>
          </div>
        )}
      </div>
    );
  }

  const items = data.replay;
  const item = items[gi];
  const interactive = item.options != null;
  const revealed = !interactive || answered;
  const last = gi === items.length - 1;
  const revealId = `rc-rr-reveal-${gi}`;

  const pick = (opt: string) => {
    if (answered) return;
    setPickedOpt(opt);
    setAnswered(true);
    showToast(opt === item.answer ? "Correct now → the pattern is locking in." : "Missed again → this is exactly your growth point.");
  };

  const recall = () => {
    if (answered) return;
    setPickedOpt(null);
    setAnswered(true);
    showToast("Recalled first, then checked — that is how it sticks.");
  };

  const next = () => {
    if (!last) {
      setGi(gi + 1);
      setAnswered(false);
      setPickedOpt(null);
      return;
    }
    if (finished) return;
    setFinished(true);
    scrollToDock();
    showToast(`Ready — the ${data.plan.weakLabel} drill targets exactly this habit.`);
  };

  return (
    <div className="rc-rr">
      <div className="rc-rr-top">
        <span className="rc-rr-title">Review your key misses</span>
        <span className="rc-rr-prog">{gi + 1} / {items.length}</span>
      </div>
      <div className="rc-rr-track"><i style={{ width: `${((gi + 1) / items.length) * 100}%` }} /></div>

      <div className="rc-rr-type">Q{item.number} · {item.type}</div>
      <div className="rc-rr-q">{item.stem}</div>

      {interactive ? (
        <div className="rc-rr-opts">
          {item.options!.map((opt) => {
            const isRight = answered && opt === item.answer;
            const isWrong = answered && !isRight && opt === pickedOpt;
            const isDim = answered && !isRight && !isWrong;
            return (
              <button
                key={opt}
                type="button"
                className={`rc-opt${isRight ? " right" : isWrong ? " wrong" : isDim ? " dim" : ""}`}
                onClick={() => pick(opt)}
                disabled={answered}
                aria-expanded={answered}
                aria-controls={revealId}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rc-rr-opts">
          <button type="button" className={`rc-opt${answered ? " right" : ""}`} onClick={recall} disabled={answered} aria-expanded={answered} aria-controls={revealId}>
            Recall it… then reveal →
          </button>
        </div>
      )}

      {revealed && (
        <FadeUp durationMs={300} key={gi}>
          <div className="rc-rev" id={revealId}>
            <div className={`rc-rev-verdict${interactive ? (pickedOpt === item.answer ? " ok" : " no") : ""}`}>
              {interactive
                ? pickedOpt === item.answer
                  ? "✓ Right — now it's yours."
                  : "✕ Still slips — here's why:"
                : `The answer is «${item.answer}».`}
            </div>
            {(item.why || item.strategy || item.tag) && (
              <div className="rc-rev-why">
                {(item.why || item.strategy) && <>💡 <span>{item.why || item.strategy}</span></>}
                {item.tag && <span className="rc-rev-tag">{item.tag}</span>}
              </div>
            )}
            {item.evidence ? (
              <div className="rc-ev">📖 <span>{item.evidence}</span></div>
            ) : (
              <div className="rc-evstub">The passage line that proves this is shown here in your real result, highlighted in the reading view.</div>
            )}
            <div className="rc-rr-foot">
              <button type="button" className="rc-rr-skip" onClick={onSkipToKey}>Skip to answer key →</button>
              <button type="button" className="rc-rr-next" onClick={next}>
                {last ? "Finish → drill this →" : "Next miss →"}
              </button>
            </div>
          </div>
        </FadeUp>
      )}
    </div>
  );
}

/* ============================================================ By type (S4) */

function ByType({
  level,
  totalQuestions,
  active,
  onFocus,
}: {
  level: DebriefData["level"];
  totalQuestions: number;
  active: boolean;
  onFocus: (type: string) => void;
}) {
  const barRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const drawnRef = useRef(false);

  // Bars render at their real (final) width via inline style — correct from
  // first paint, no JS required. This only layers a 0→width grow-in the
  // FIRST time the tab is actually shown (matches the prototype's barsDrawn
  // guard), and is skipped under reduced motion.
  useEffect(() => {
    if (!active || drawnRef.current || prefersReduced()) return;
    drawnRef.current = true;
    level.rows.forEach((r) => {
      const el = barRefs.current[r.type];
      if (!el) return;
      const target = el.style.width;
      el.animate([{ width: "0%" }, { width: target }], { duration: 600, easing: EASE_OUT, fill: "backwards" });
    });
  }, [active, level.rows]);

  return (
    <div>
      <div className="rc-bt-head">
        <h2>Where the marks went</h2>
        <p>Sorted worst → best. Your weakest type is <b>the biggest pool of marks</b> to win back — that&rsquo;s your start line.</p>
      </div>
      <div className="rc-bt-card">
        <div>
          {level.rows.map((r) => {
            const ratio = r.total > 0 ? r.correct / r.total : 0;
            // r.weak — единая цель коучинга (page.tsx focusQType), не жёстко
            // rows[0]: worst-по-проценту тип и диагностированный blindSpot
            // могут быть разными типами.
            const isFocus = r.weak;
            const pctWidth = Math.max(ratio * 100, 3);
            const open = () => onFocus(r.type);
            return (
              <div
                key={r.type}
                className={`rc-bt-row${isFocus ? " focus" : ""}`}
                role="button"
                tabIndex={0}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open();
                  }
                }}
              >
                <div className="rc-bt-top">
                  <span className="rc-bt-name">{r.label}</span>
                  {isFocus && <span className="rc-bt-focus">start here</span>}
                  <span className="rc-bt-score" style={r.correct === 0 ? { color: "var(--error-text)" } : undefined}>{r.correct}/{r.total}</span>
                  <span className="rc-bt-go">review {r.total} →</span>
                </div>
                <div className="rc-bt-bar">
                  <span ref={(el) => { barRefs.current[r.type] = el; }} style={{ width: `${pctWidth}%`, background: barColor(ratio) }} />
                </div>
                {isFocus && (
                  <div className="rc-bt-note">Your weakest type — the biggest block of marks still on the table. Win these back first.</div>
                )}
              </div>
            );
          })}
        </div>
        <div className="rc-bt-legend">
          <span className="k"><span className="sw" style={{ background: "var(--success)" }} />strong</span>
          <span className="k"><span className="sw" style={{ background: "var(--warn)" }} />shaky</span>
          <span className="k"><span className="sw" style={{ background: "var(--error)" }} />weak</span>
          <span className="k" style={{ marginLeft: "auto" }}>{level.rows.length} types · {totalQuestions} questions</span>
        </div>
      </div>
      {level.growth && <GrowthStrip growth={level.growth} />}
    </div>
  );
}

function GrowthStrip({ growth }: { growth: NonNullable<DebriefData["level"]["growth"]> }) {
  return (
    <div className="rc-grow">
      <div className="rc-grow-bars">
        {growth.series.map((b) => {
          const p = b.total > 0 ? (b.correct / b.total) * 100 : 0;
          return (
            <span className="rc-gb" key={b.tag}>
              <i style={{ height: `${Math.max(p, 6) * 0.44}px` }} />
              <small>{b.tag}</small>
            </span>
          );
        })}
      </div>
      <div className="rc-grow-txt">
        {growth.deltaType > 0 ? (
          <><b>+{growth.deltaType} on {growth.label}</b> since your first try. You&rsquo;re already climbing — the replay above is how you keep it.</>
        ) : growth.deltaType === 0 ? (
          <>Same {growth.label} score as your first try — the replay above is how you move it.</>
        ) : (
          <>{growth.deltaType} on {growth.label} since your first try — the replay above is how you turn it around.</>
        )}
      </div>
    </div>
  );
}

/* =================================================================== Dock */

function Dock({ data, dockRef }: { data: DebriefData; dockRef: RefObject<HTMLDivElement | null> }) {
  const { score, blindSpot, plan } = data;
  const pct = Math.round(score.correctPct * 100);
  const dotValue = score.marksToNext ?? blindSpot?.costMarks ?? null;
  const milestoneText =
    score.banded && score.nextBand != null && score.marksToNext != null
      ? `Next milestone: ${Math.round(((score.raw + score.marksToNext) / score.total) * 100)}% → Band ${score.nextBand}.`
      : !score.banded && pct < 100
        ? `Next milestone: ${Math.min(100, Math.ceil((pct + 1) / 10) * 10)}%.`
        : null;
  const hasDrill = Boolean(plan.weakLabel && plan.drillHref);

  return (
    <div className="rc-dock" ref={dockRef}>
      <div className="rc-dock-in">
        {dotValue != null && milestoneText && (
          <div className="rc-dock-l">
            <div className="rc-dock-dot">+{dotValue}</div>
            <div className="rc-dock-t">
              <b>{milestoneText}</b>
              {blindSpot && (
                <>
                  <br />
                  <span>Fixing your {blindSpot.label} habit ≈ {blindSpot.costMarks} marks.</span>
                </>
              )}
            </div>
          </div>
        )}
        <div className="rc-dock-r">
          <Button variant="secondary" href={plan.retryHref}>Re-sit test</Button>
          {hasDrill && (
            <Button href={plan.drillHref!}>
              🎯 <span className="rc-dock-full">Start {plan.weakLabel} drill</span><span className="rc-dock-short">Start drill</span>
              <span className="rc-dock-time" style={{ opacity: 0.7, fontWeight: 600 }}> · ~10 min</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* Breakpoint-switched properties live in classes, never inline (responsive-
   inline-class invariant). Sticky offsets mirror the app's top:60/88 header
   pattern (see Annotations.tsx/_Transcript.tsx: "top:88 clears the sticky
   header"). Reduced-motion turns off every CSS transition/animation here —
   the WAAPI calls above already early-return under the same media query, so
   between the two, nothing moves and every element is in its final state. */
const COACH_CSS = `
.rc-verdict{position:relative;overflow:hidden;border-radius:var(--radius-2xl);margin-top:14px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-md)}
.rc-verdict::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 90% at 100% -10%, var(--brand-subtle), transparent 55%)}
.rc-vd-in{position:relative;padding:30px 34px 32px}
.rc-vd-meta{font-family:var(--font-ui);font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--text-muted);margin-bottom:22px}
.rc-vd-meta b{color:var(--text-secondary)}
.rc-vd-grid{display:grid;grid-template-columns:auto 1px 1fr;gap:34px;align-items:center}
.rc-vd-rule{align-self:stretch;background:var(--border-subtle);width:1px;margin:6px 0}
.rc-vd-score{display:flex;align-items:baseline;gap:10px;margin-top:12px;justify-content:center}
.rc-vd-score .p{font-family:var(--font-mono);font-weight:700;font-size:19px;color:var(--text-primary)}
.rc-vd-score .s{font-family:var(--font-ui);font-size:12px;color:var(--text-muted)}
.rc-vd-ey{font-family:var(--font-ui);font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--brand-active);margin-bottom:10px}
.rc-vd-h{font-family:var(--font-ui);font-size:clamp(1.55rem,3.6vw,2.15rem);font-weight:900;letter-spacing:-.03em;line-height:1.08;text-wrap:balance}
.rc-vd-h em{font-style:normal;color:var(--brand-active)}
.rc-vd-p{font-family:var(--font-ui);color:var(--text-secondary);font-size:14.5px;margin-top:12px;max-width:46ch;line-height:1.55}
.rc-vd-p b{color:var(--text-primary)}
.rc-vd-actions{display:flex;gap:10px;margin-top:22px;flex-wrap:wrap}
@media (max-width:680px){
  .rc-vd-grid{grid-template-columns:1fr;gap:22px;text-align:center;justify-items:center}
  .rc-vd-rule{display:none}
  .rc-vd-p{margin-left:auto;margin-right:auto}
  .rc-vd-actions{justify-content:center}
}

.rc-tabs{position:sticky;top:60px;z-index:20;background:color-mix(in oklab, var(--bg-base) 90%, transparent);backdrop-filter:blur(8px);margin:30px -18px 0;padding:16px 18px 6px}
@media (min-width:1024px){ .rc-tabs{top:88px} }
.rc-seg{display:flex;gap:4px;background:var(--surface-inset);border:1px solid var(--border-subtle);border-radius:14px;padding:5px;width:max-content;max-width:100%;overflow-x:auto;scrollbar-width:none}
.rc-seg::-webkit-scrollbar{display:none}
.rc-tab{flex:none;display:inline-flex;align-items:center;gap:8px;font-family:var(--font-ui);font-size:13.5px;font-weight:700;color:var(--text-secondary);padding:9px 16px;border-radius:10px;border:0;background:transparent;cursor:pointer;white-space:nowrap;transition:var(--transition-colors);min-height:40px}
.rc-tab .rc-b{font-family:var(--font-mono);font-size:11px;font-weight:700;background:var(--border);color:var(--text-muted);border-radius:999px;padding:1px 7px}
.rc-tab.on{background:var(--surface);color:var(--brand-active);box-shadow:var(--shadow-sm)}
.rc-tab.on .rc-b{background:var(--brand);color:#fff}
.rc-panel{padding:22px 0 0}
.rc-panel.hide{display:none}
.rc-hint{font-family:var(--font-ui);font-size:12.5px;color:var(--text-muted);text-align:center;margin-top:16px}

.rc-rr{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xl);box-shadow:var(--shadow-md);padding:24px 26px;max-width:660px;margin:0 auto}
.rc-rr-perfect{font-family:var(--font-ui);font-size:var(--text-sm);color:var(--text-secondary);text-align:center;padding:12px 0}
.rc-rr-lead{font-family:var(--font-ui);font-size:13.5px;color:var(--text-secondary);margin-bottom:12px}
.rc-rr-chips{display:flex;flex-wrap:wrap;gap:8px}
.rc-rr-chip{font-family:var(--font-mono);font-size:var(--text-xs);font-weight:600;color:var(--text-secondary);background:var(--surface-inset);border-radius:999px;padding:6px 12px}
.rc-upsell{margin-top:18px;border:1px solid var(--brand-border);background:var(--brand-subtle);border-radius:var(--radius-xl);padding:1.4rem 1.3rem;text-align:center}
.rc-upsell-title{font-family:var(--font-ui);font-size:var(--text-lg);font-weight:800;color:var(--text-link)}
.rc-upsell-text{font-family:var(--font-ui);color:var(--text-secondary);font-size:var(--text-sm);margin:.5rem auto 1rem;max-width:440px;line-height:1.5}
.rc-rr-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.rc-rr-title{font-family:var(--font-ui);font-size:14px;font-weight:800}
.rc-rr-prog{font-family:var(--font-mono);font-size:12px;color:var(--text-muted)}
.rc-rr-track{height:6px;border-radius:999px;background:var(--surface-inset);overflow:hidden;margin-bottom:20px}
.rc-rr-track i{display:block;height:100%;background:var(--brand);border-radius:999px;transition:width .45s var(--ease-standard)}
.rc-rr-type{display:inline-flex;align-items:center;gap:8px;font-family:var(--font-ui);font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--brand-active);background:var(--brand-subtle);border:1px solid var(--brand-border);border-radius:8px;padding:5px 10px;margin-bottom:14px}
.rc-rr-q{font-family:var(--font-reading);font-size:18px;color:var(--text-primary);line-height:1.5;margin-bottom:18px}
.rc-rr-opts{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:6px}
.rc-opt{font-family:var(--font-ui);font-weight:700;font-size:14px;border:1.5px solid var(--border);background:var(--surface);color:var(--text-secondary);padding:12px 20px;border-radius:12px;cursor:pointer;transition:var(--transition-colors);min-height:44px}
.rc-opt:hover:not(:disabled){border-color:var(--brand-border);color:var(--text-primary)}
.rc-opt:disabled{cursor:default}
.rc-opt.right{border-color:var(--success);background:var(--success-subtle);color:var(--success-text)}
.rc-opt.wrong{border-color:var(--error);background:var(--error-subtle);color:var(--error-text)}
.rc-opt.dim{opacity:.5}
.rc-rev{margin-top:20px;border-top:1px solid var(--border-subtle);padding-top:18px}
.rc-rev-verdict{display:flex;align-items:center;gap:9px;font-family:var(--font-ui);font-weight:800;font-size:15px;margin-bottom:12px;color:var(--text-primary)}
.rc-rev-verdict.ok{color:var(--success-text)}
.rc-rev-verdict.no{color:var(--error-text)}
.rc-rev-why{display:flex;gap:10px;font-family:var(--font-ui);font-size:14px;color:var(--text-secondary);line-height:1.55;margin-bottom:14px}
.rc-rev-why b{color:var(--text-primary)}
.rc-rev-tag{font-family:var(--font-ui);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--warn-text);background:var(--warn-subtle);border-radius:6px;padding:3px 8px;margin-left:auto;flex:none}
.rc-ev{display:flex;gap:11px;font-family:var(--font-reading);font-size:14px;color:var(--reading-text);background:var(--reading-surface);border:1px solid var(--reading-rule);border-radius:12px;padding:14px 16px;line-height:1.6}
/* .rc-ev mark сознательно не портирован из прототипа: evidence рендерится как
   плоский текст (React text child, не dangerouslySetInnerHTML) — <mark> в
   данных нет и не может отрендериться, правило было бы мёртвым CSS. */
.rc-evstub{font-family:var(--font-ui);font-size:12.5px;color:var(--text-muted);font-style:italic;padding:11px 13px;border:1px dashed var(--border);border-radius:10px;line-height:1.5}
.rc-rr-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px}
.rc-rr-skip{font-family:var(--font-ui);font-size:13px;font-weight:600;color:var(--text-muted);background:0;border:0;cursor:pointer;min-height:44px}
.rc-rr-next{display:inline-flex;align-items:center;gap:8px;background:var(--brand);color:#fff;font-family:var(--font-ui);font-weight:700;font-size:14px;border:0;border-radius:12px;padding:12px 20px;cursor:pointer;box-shadow:0 2px 0 var(--brand-active);transition:var(--transition-transform);min-height:44px}
.rc-rr-next:hover{background:var(--brand-hover);transform:translateY(-1px)}

.rc-bt-head{max-width:60ch;margin:0 auto 22px;text-align:center}
.rc-bt-head h2{font-family:var(--font-ui);font-size:clamp(1.3rem,3vw,1.6rem);font-weight:800;letter-spacing:-.02em}
.rc-bt-head p{font-family:var(--font-ui);font-size:14px;color:var(--text-secondary);margin-top:8px}
.rc-bt-head p b{color:var(--text-primary)}
.rc-bt-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xl);box-shadow:var(--shadow-md);padding:12px 24px;max-width:660px;margin:0 auto}
.rc-bt-row{display:flex;flex-direction:column;gap:9px;padding:15px 0;border-top:1px solid var(--border-subtle);cursor:pointer;transition:color .15s var(--ease-standard)}
.rc-bt-row:first-child{border-top:0}
.rc-bt-top{display:flex;align-items:center;gap:10px}
.rc-bt-name{font-family:var(--font-ui);font-size:14.5px;font-weight:700;transition:color .15s var(--ease-standard)}
.rc-bt-row:hover .rc-bt-name{color:var(--brand-active)}
.rc-bt-focus{font-family:var(--font-ui);font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;background:var(--brand);color:#fff;border-radius:6px;padding:3px 8px}
.rc-bt-score{margin-left:auto;font-family:var(--font-mono);font-weight:700;font-size:14px;color:var(--text-secondary)}
.rc-bt-go{font-family:var(--font-ui);font-size:12px;font-weight:800;color:var(--brand-active);opacity:0;transform:translateX(-5px);transition:.15s var(--ease-standard);white-space:nowrap}
.rc-bt-row:hover .rc-bt-go{opacity:1;transform:none}
.rc-bt-bar{position:relative;height:10px;border-radius:999px;background:var(--surface-inset);overflow:hidden}
.rc-bt-bar span{position:absolute;left:0;top:0;bottom:0;border-radius:999px}
.rc-bt-row.focus{background:var(--brand-subtle);border-radius:14px;border-top-color:transparent;padding:16px;margin:6px 0}
.rc-bt-row.focus:hover{background:color-mix(in oklab, var(--brand-subtle) 80%, var(--brand-border))}
.rc-bt-note{font-family:var(--font-ui);font-size:12.5px;color:var(--brand-active);font-weight:600;margin-top:2px}
.rc-bt-legend{display:flex;gap:16px;padding:16px 0 6px;font-family:var(--font-ui);font-size:12px;color:var(--text-muted);flex-wrap:wrap;align-items:center}
.rc-bt-legend .k{display:inline-flex;align-items:center;gap:6px}
.rc-bt-legend .sw{width:12px;height:12px;border-radius:4px}

.rc-grow{display:flex;align-items:center;gap:14px;margin:16px auto 0;max-width:660px;padding-top:14px;border-top:1px solid var(--border-subtle)}
.rc-grow-bars{display:flex;align-items:flex-end;gap:8px;height:44px;flex:none}
.rc-gb{display:flex;flex-direction:column;align-items:center;gap:4px;justify-content:flex-end}
.rc-gb i{width:26px;display:block;border-radius:5px 5px 2px 2px;background:var(--brand-border)}
.rc-gb:last-child i{background:var(--brand)}
.rc-gb small{font-family:var(--font-mono);font-size:9.5px;color:var(--text-muted)}
.rc-grow-txt{font-family:var(--font-ui);font-size:12.5px;color:var(--text-secondary);line-height:1.5}
.rc-grow-txt b{color:var(--success-text)}

.rc-dock{position:fixed;left:0;right:0;bottom:0;z-index:30;background:color-mix(in oklab, var(--surface) 82%, transparent);backdrop-filter:blur(14px);border-top:1px solid var(--border)}
.rc-dock-in{max-width:760px;margin:0 auto;display:flex;align-items:center;gap:16px;padding:12px 18px}
.rc-dock-l{display:flex;align-items:center;gap:12px;min-width:0}
.rc-dock-dot{width:38px;height:38px;flex:none;border-radius:11px;background:var(--brand-subtle);color:var(--brand-active);display:grid;place-items:center;font-family:var(--font-mono);font-weight:700;font-size:13px}
.rc-dock-t{font-family:var(--font-ui);font-size:13px;line-height:1.35;min-width:0}
.rc-dock-t b{font-weight:800;color:var(--text-primary)}
.rc-dock-t span{color:var(--text-muted)}
.rc-dock-r{margin-left:auto;display:flex;gap:10px;flex-shrink:0}
.rc-dock-short{display:none}
.rc-toast{position:fixed;left:50%;bottom:88px;transform:translate(-50%,140%);opacity:0;pointer-events:none;background:var(--surface-inverse);color:var(--surface-inverse-ink);font-family:var(--font-ui);font-size:13.5px;font-weight:600;padding:12px 18px;border-radius:var(--radius-md);box-shadow:var(--shadow-md);transition:transform .3s var(--ease-out),opacity .3s;z-index:60;max-width:92vw}
.rc-toast.show{transform:translate(-50%,0);opacity:1}

@media (max-width:680px){
  .rc-dock-in{gap:10px}
  .rc-dock-l{display:none}
  .rc-dock-r{margin:0;width:100%}
  /* min-width:0!important — Button задаёт свой min-width инлайн-стилем
     (React style prop), внешний класс без !important его не перебьёт;
     без этого длинный лейбл распирает flex:1-кнопку и клипается на ≤680. */
  .rc-dock-r > a,.rc-dock-r > button{flex:1;justify-content:center;min-width:0!important}
  .rc-dock-time{display:none}
}
@media (max-width:430px){
  .rc-dock-full{display:none}
  .rc-dock-short{display:inline}
}
@media (prefers-reduced-motion:reduce){
  .rc-rr-track i,.rc-opt,.rc-rr-next,.rc-bt-row,.rc-bt-name,.rc-bt-go,.rc-bt-bar span,.rc-toast,.rc-tab{transition:none}
}
`;
