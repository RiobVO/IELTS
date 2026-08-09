"use client";

/**
 * Debrief — «дебриф»-версия /result: результат раскрывается как история из
 * глав (Score → The one thing → Replay → Your level → Next move), одна мысль
 * на главу вместо плотного отчёта. Порт result-ideal.html на bando-токены.
 *
 * Инвариант: контент виден БЕЗ JS с самого начала (SSR-финал); IntersectionObserver
 * + WAAPI ниже — только décor поверх уже-видимого дефолта, и полностью выключены
 * при prefers-reduced-motion (см. reveal.tsx/InsightReport.tsx — тот же паттерн).
 * Все данные уже посчитаны на сервере (page.tsx) — этот компонент только рендерит.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import { categoryLabel } from "@/lib/labels";
import type { DebriefData } from "@/lib/result/debrief";
import BadgeUnlock from "./BadgeUnlock";
import { ShareResult } from "./ShareResult";
import { AnimatedDonut, CountUp } from "./reveal";

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

function prefersReduced(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const barColor = (p: number) => (p < 45 ? "var(--error)" : p < 70 ? "var(--warn)" : "var(--success)");
const barTextColor = (p: number) => (p < 45 ? "var(--error-text)" : p < 70 ? "var(--warn-text)" : "var(--success-text)");

interface UnlockedBadge {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
}

export default function Debrief({ data, unlockedBadges }: { data: DebriefData; unlockedBadges: UnlockedBadge[] }) {
  const [activeId, setActiveId] = useState("s1");
  const sectionsRef = useRef<Record<string, HTMLElement | null>>({});
  const playedRef = useRef<Set<string>>(new Set());
  // Replay-степпер (S3) поднимает "готово" сюда — чапнав ставит .done, а не
  // сам степпер (у него нет доступа к списку глав).
  const [replayDone, setReplayDone] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  };

  // Sticky chapnav только для глав, которые реально рендерятся (blindSpot/level
  // могут отсутствовать в крайних случаях — 0 вопросов и т.п.) — иначе якорь
  // указывал бы в никуда. Нумерация статична (как в прототипе); в этом крайнем
  // случае она может «перескочить» — не критично, до этой страницы такие
  // попытки практически не доходят (0 вопросов отсекается раньше).
  const chapters = [
    { id: "s1", label: "Score" },
    ...(data.blindSpot ? [{ id: "s2", label: "1 · The one thing" }] : []),
    { id: "s3", label: "2 · Replay" },
    ...(data.level.rows.length > 0 ? [{ id: "s4", label: "3 · Your level" }] : []),
    { id: "s5", label: "4 · Next move" },
  ];

  useEffect(() => {
    const els = Object.values(sectionsRef.current).filter((el): el is HTMLElement => el != null);
    if (els.length === 0) return;
    const reduce = prefersReduced();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          setActiveId(entry.target.id);
          if (!reduce && !playedRef.current.has(entry.target.id)) {
            playedRef.current.add(entry.target.id);
            entry.target.animate(
              [
                { opacity: 0, transform: "translateY(24px)" },
                { opacity: 1, transform: "none" },
              ],
              { duration: 560, easing: EASE_OUT, fill: "backwards" },
            );
          }
        });
      },
      { threshold: 0.35 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: prefersReduced() ? "auto" : "smooth" });
  };

  return (
    <div>
      <style>{DEBRIEF_CSS}</style>

      <nav className="db-chapnav" aria-label="Debrief chapters">
        <div className="db-chapnav-in">
          {chapters.map((c) => (
            <a
              key={c.id}
              href={`#${c.id}`}
              className={`db-chap${activeId === c.id ? " on" : ""}${c.id === "s3" && replayDone ? " done" : ""}`}
              aria-current={activeId === c.id ? "true" : undefined}
            >
              <i />
              {c.label}
            </a>
          ))}
        </div>
      </nav>

      <section id="s1" ref={(el) => { sectionsRef.current.s1 = el; }} className="db-mo">
        <ScoreReveal data={data} onContinue={() => scrollTo(data.blindSpot ? "s2" : "s3")} />
      </section>

      {unlockedBadges.length > 0 && (
        <div style={{ margin: "14px 0" }}>
          <BadgeUnlock badges={unlockedBadges} />
        </div>
      )}

      {data.blindSpot && (
        <section id="s2" ref={(el) => { sectionsRef.current.s2 = el; }} className="db-mo">
          <ChapterEyebrow n={1} label="The one thing" />
          <BlindSpotCard blindSpot={data.blindSpot} nextBand={data.score.nextBand} />
        </section>
      )}

      <section id="s3" ref={(el) => { sectionsRef.current.s3 = el; }} className="db-mo">
        <ChapterEyebrow n={2} label="Replay your misses" />
        <ReplaySection
          data={data}
          onDone={() => {
            setReplayDone(true);
            showToast("Replay complete — nice work.");
          }}
        />
      </section>

      {data.level.rows.length > 0 && (
        <section id="s4" ref={(el) => { sectionsRef.current.s4 = el; }} className="db-mo">
          <ChapterEyebrow n={3} label="Your level" />
          <LevelCard level={data.level} />
        </section>
      )}

      <section id="s5" ref={(el) => { sectionsRef.current.s5 = el; }} className="db-mo">
        <ChapterEyebrow n={4} label="Next move" />
        <NextMoveCard data={data} />
      </section>

      <div className={`db-toast${toastMsg ? " show" : ""}`} role="status" aria-live="polite">
        {toastMsg}
      </div>
    </div>
  );
}

function ChapterEyebrow({ n, label }: { n: number; label: string }) {
  return (
    <div className="db-eyebrow">
      Chapter {n} · {label}
      <span className="db-eyebrow-ln" />
    </div>
  );
}

/* ===================================================================== S1 */

function ScoreReveal({ data, onContinue }: { data: DebriefData; onContinue: () => void }) {
  const { score } = data;
  const pct = Math.round(score.correctPct * 100);
  const bandValue = score.banded && score.band != null ? score.band : null;

  let verdict: string;
  if (bandValue != null && score.nextBand != null && score.marksToNext != null) {
    verdict = `You were ${score.marksToNext} mark${score.marksToNext === 1 ? "" : "s"} from Band ${score.nextBand}.`;
  } else if (bandValue != null) {
    verdict = `You scored Band ${bandValue}.`;
  } else if (pct >= 100) {
    verdict = "Perfect score.";
  } else {
    const milestone = Math.min(100, Math.ceil((pct + 1) / 10) * 10);
    verdict = `You're ${milestone - pct}% from your next milestone (${milestone}%).`;
  }

  // Полоса+цель опираются на ту же шкалу, что и near-miss — скрыты у не-banded
  // попыток (только проценты, decision §1: «band-бар скрыт»).
  const showBar = bandValue != null && score.nextBand != null && score.marksToNext != null;
  const goalPct = showBar ? Math.min(96, ((score.raw + score.marksToNext!) / score.total) * 100) : 0;

  return (
    <div className="db-reveal">
      <div className="db-rv-sub">
        Your debrief · {data.title}
        {data.category ? ` · ${categoryLabel(data.category)}` : ""} · {data.totalQuestions} questions
      </div>
      <AnimatedDonut pct={score.correctPct} />
      <div className="db-rv-band">
        <div className="db-rv-eyebrow">{bandValue != null ? "Band score" : "Score"}</div>
        <div className="db-rv-n">
          <CountUp value={bandValue ?? pct} decimals={bandValue != null ? 1 : 0} suffix={bandValue != null ? "" : "%"} />
        </div>
        <div className="db-rv-raw">{score.raw}/{score.total} correct</div>
      </div>
      <h2 className="db-rv-verdict">{verdict}</h2>
      {showBar && (
        <div className="db-rv-bar">
          <div className="db-rv-bar-f" style={{ width: `${pct}%` }} />
          <div className="db-rv-bar-g" style={{ left: `${goalPct}%` }} />
          <div className="db-rv-bar-gl" style={{ left: `${goalPct}%` }}>Band {score.nextBand}</div>
        </div>
      )}
      {data.metrics.length > 0 && (
        <div className="db-rv-chips">
          {data.metrics.map((m) => (
            <span className="db-rv-chip" key={m.label}>
              <b style={{ color: m.color }}>{m.value}</b>
              {m.label}
            </span>
          ))}
        </div>
      )}
      <button type="button" className="db-rv-go" onClick={onContinue}>
        See what happened <Icon name="chevron-down" size={15} strokeWidth={2.5} />
      </button>
    </div>
  );
}

/* ===================================================================== S2 */

function BlindSpotCard({
  blindSpot,
  nextBand,
}: {
  blindSpot: NonNullable<DebriefData["blindSpot"]>;
  nextBand: number | null;
}) {
  const { label, weakBucket, strongBucket, costMarks } = blindSpot;
  const isNg = label === "Not Given";
  const marks = `${costMarks} mark${costMarks === 1 ? "" : "s"}`;

  const sub = strongBucket
    ? isNg
      ? `When the text clearly states an answer, you get it (${strongBucket.correct}/${strongBucket.total}). But when it says nothing, you guess — and that guess costs you. That one habit cost you ${marks} today.`
      : `You're sharp at spotting when nothing is stated (${strongBucket.correct}/${strongBucket.total}). But when the text DOES give a clear answer, you're missing it — that cost you ${marks} today.`
    : `You get ${weakBucket.correct} of ${weakBucket.total} right here — the rest of your answers average much higher. Fixing just this type is the fastest points on the board.`;

  return (
    <div className="db-one">
      <h2 className="db-one-h2">
        <em>{label}</em> {strongBucket ? "is quietly stealing your marks." : "is where you're losing the most marks."}
      </h2>
      <p className="db-one-sub">{sub}</p>
      {strongBucket && (
        <div className="db-one-split">
          <div className="db-one-cell g">
            <div className="db-one-v">{strongBucket.correct}/{strongBucket.total}</div>
            <div className="db-one-l">{isNg ? "Stated answers — you've got this" : "Not Given — you've got this"}</div>
          </div>
          <div className="db-one-cell b">
            <div className="db-one-v">{weakBucket.correct}/{weakBucket.total}</div>
            <div className="db-one-l">{label} — your blind spot</div>
          </div>
        </div>
      )}
      <span className="db-one-prize">
        🎯 Fix this one habit = +{marks}{nextBand != null ? ` ≈ Band ${nextBand}` : ""}
      </span>
    </div>
  );
}

/* ===================================================================== S3 */
/* Guided replay: пропущенные вопросы по одному, "без таймера". Re-pick
   интерактивен только для tfng/ynng (options != null) — прочие типы сразу
   показывают reveal-панель (decision §3). Только при fullReview; иначе —
   безопасный список Q-номеров/типов + апселл (answer/why/evidence на клиент
   не попадают вовсе — DebriefData.replay пуст, когда replayLocked). */

function ReplaySection({ data, onDone }: { data: DebriefData; onDone: () => void }) {
  const [gi, setGi] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [pickedOpt, setPickedOpt] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  if (data.missed.length === 0) {
    return (
      <div className="db-rep">
        <p className="db-rep-perfect">Perfect run — nothing to replay. 🎉</p>
      </div>
    );
  }
  if (data.replayLocked || data.replay.length === 0) {
    return (
      <div className="db-rep">
        <p className="db-rep-lead">
          You missed {data.missed.length} question{data.missed.length === 1 ? "" : "s"} — replay them below.
        </p>
        <div className="db-rep-chips">
          {data.missed.map((m) => (
            <span className="db-rep-chip" key={m.number}>Q{m.number} · {m.label}</span>
          ))}
        </div>
        {data.replayLocked && (
          <div className="db-upsell">
            <div className="db-upsell-title">See the answers and why</div>
            <p className="db-upsell-text">
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
  const revealId = `db-gr-reveal-${gi}`;

  const pick = (opt: string) => {
    if (answered) return;
    setPickedOpt(opt);
    setAnswered(true);
  };

  const next = () => {
    if (gi < items.length - 1) {
      setGi(gi + 1);
      setAnswered(false);
      setPickedOpt(null);
    } else if (!finished) {
      setFinished(true);
      onDone();
    }
  };

  return (
    <div className="db-rep">
      {finished && (
        <div className="db-rep-stamp">
          Reviewed ✓<small>{items.length} of {items.length} replayed</small>
        </div>
      )}
      <div className="db-rep-top">
        <span className="db-rep-title">Replay the marks you lost</span>
        <span className="db-rep-prog">{gi + 1} / {items.length}</span>
      </div>
      <p className="db-rep-lead">Answer again — <b>without the timer</b>. Then see the proof in the text.</p>
      <div className="db-rep-track"><i style={{ width: `${((gi + 1) / items.length) * 100}%` }} /></div>

      <div className="db-gr-q"><span className="db-gr-qn">Q{item.number} · {item.type}</span>{item.stem}</div>

      {interactive && (
        <div className="db-gr-guess">
          {item.options!.map((opt) => {
            const isRight = answered && opt === item.answer;
            const isWrong = answered && !isRight && opt === pickedOpt;
            return (
              <button
                key={opt}
                type="button"
                className={`db-gr-opt${isRight ? " right" : isWrong ? " wrong" : ""}`}
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
      )}

      {revealed && (
        <div className="db-gr-reveal" id={revealId}>
          <div className={`db-gr-verdict ${interactive ? (pickedOpt === item.answer ? "ok" : "no") : "no"}`}>
            {interactive
              ? pickedOpt === item.answer
                ? "✓ Right this time — the habit is forming."
                : "✕ Same trap — now watch how it works:"
              : item.given === "—"
                ? `You left this blank — the correct answer is "${item.answer}".`
                : `You answered "${item.given}" — the correct answer is "${item.answer}".`}
          </div>
          {item.why && <div className="db-gr-why">💡 <span>{item.why}</span></div>}
          {item.evidence && <div className="db-gr-ev">📖 <span>&ldquo;{item.evidence}&rdquo;</span></div>}
          <button type="button" className="db-gr-next" onClick={next}>
            {gi < items.length - 1 ? "Next miss →" : "Finish replay ✓"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ===================================================================== S4 */

function LevelCard({ level }: { level: DebriefData["level"] }) {
  const avgPctDisplay = Math.round(level.avgPct * 100);
  const worst = level.rows[0];
  const gain = worst ? Math.max(0, Math.round(level.avgPct * worst.total) - worst.correct) : 0;

  return (
    <div className="db-lvl">
      <h3 className="db-lvl-h3">You&rsquo;re a {avgPctDisplay}% reader — everywhere except one place.</h3>
      <p className="db-lvl-lead">The purple line is <b>your own average</b>. One type sits far below it.</p>
      <div className="db-lvl-rows">
        {level.rows.map((r, i) => {
          const p = r.total > 0 ? Math.round((r.correct / r.total) * 100) : 0;
          return (
            <div className="db-lev-row" key={r.type}>
              <span className="db-lev-name" style={r.weak ? { color: "var(--error-text)", fontWeight: 700 } : undefined}>
                {r.label}
              </span>
              <span className="db-lev-track">
                {i === 0 && (
                  <span className="db-lev-avgtag" style={{ left: `${avgPctDisplay}%` }}>your average</span>
                )}
                <span className="db-lev-avgline" style={{ left: `${avgPctDisplay}%` }} />
                <span className="db-lev-fill" style={{ width: `${Math.max(p, 2)}%`, background: barColor(p) }} />
              </span>
              <span className="db-lev-score" style={{ color: barTextColor(p) }}>{r.correct}/{r.total}</span>
            </div>
          );
        })}
      </div>
      {worst && gain > 0 && (
        <div className="db-lvl-note">
          🎯 <div>
            You don&rsquo;t need to &ldquo;get better at reading&rdquo;. Pull <b>{worst.label} up to your own {avgPctDisplay}%</b> — that&rsquo;s +{gain} mark{gain === 1 ? "" : "s"}.
          </div>
        </div>
      )}
      {level.growth && (
        <div className="db-grow">
          <div className="db-grow-bars">
            {level.growth.series.map((b) => {
              const p = b.total > 0 ? (b.correct / b.total) * 100 : 0;
              return (
                <span className="db-gb" key={b.tag}>
                  <i style={{ height: `${Math.max(p, 6) * 0.44}px` }} />
                  <small>{b.tag}</small>
                </span>
              );
            })}
          </div>
          <div className="db-grow-txt">
            {level.growth.deltaType > 0 ? (
              <><b>+{level.growth.deltaType} on {level.growth.label}</b> since your first try. You&rsquo;re already climbing — the replay above is how you keep it.</>
            ) : level.growth.deltaType === 0 ? (
              <>Same {level.growth.label} score as your first try — the replay above is how you move it.</>
            ) : (
              <>{level.growth.deltaType} on {level.growth.label} since your first try — the replay above is how you turn it around.</>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================================================================== S5 */

function NextMoveCard({ data }: { data: DebriefData }) {
  const { plan, share, score } = data;
  const headline = score.nextBand != null ? `Two steps to Band ${score.nextBand}.` : "Two steps to your next milestone.";
  const hasDrill = Boolean(plan.weakLabel && plan.drillHref);

  return (
    <div className="db-next">
      <h3 className="db-next-h3">{headline}</h3>
      <p className="db-next-sub">Not &ldquo;study more&rdquo;. Exactly this:</p>
      <div className="db-plan">
        {hasDrill && (
          <div className="db-pstep">
            <span className="db-pn">1</span>
            <span className="db-pt">Drill {plan.weakLabel}-only questions</span>
            <span className="db-pm">~10 min</span>
          </div>
        )}
        <div className="db-pstep">
          <span className="db-pn">{hasDrill ? 2 : 1}</span>
          <span className="db-pt">Re-sit this test — watch the score move</span>
          <span className="db-pm">~40 min</span>
        </div>
      </div>
      <div className="db-next-cta">
        {plan.drillHref && (
          <Button href={plan.drillHref} trailingIcon="arrow-right">Start the drill</Button>
        )}
        <Button variant="secondary" href={plan.retryHref}>Re-test later</Button>
      </div>
      {share && (
        <div className="db-share">
          <div className="db-share-top">
            <span
              className="db-share-donut"
              style={{ background: `conic-gradient(#fff ${Math.round(score.correctPct * 100)}%, rgba(255,255,255,.25) 0)` }}
            >
              <b>{share.value}</b>
            </span>
            <span className="db-share-text">&ldquo;{share.headline}&rdquo;</span>
          </div>
          <ShareResult refCode={share.refCode} headline={share.headline} />
        </div>
      )}
    </div>
  );
}

/* Интерактив/адаптив/reduced-motion живут в классах (inline не умеет :hover и
   переопределяет media-query — responsive-inline-class invariant). top:88px
   в @media(min-width:1024px) — тот же оффсет sticky-хедера, что и в остальном
   /app (см. Annotations.tsx/_Transcript.tsx: "top:88 clears the sticky header"). */
const DEBRIEF_CSS = `
.db-chapnav{position:sticky;top:60px;z-index:20;background:color-mix(in oklab, var(--bg-base) 88%, transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--border-subtle);margin:0 -18px;padding:10px 18px}
.db-chapnav-in{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
.db-chapnav-in::-webkit-scrollbar{display:none}
.db-chap{flex:none;display:inline-flex;align-items:center;gap:7px;font-family:var(--font-ui);font-size:11.5px;font-weight:700;color:var(--text-muted);border-radius:var(--radius-full);padding:6px 12px;border:1px solid transparent;transition:var(--transition-colors);white-space:nowrap;text-decoration:none;min-height:32px}
.db-chap i{width:6px;height:6px;border-radius:50%;background:var(--border-strong);transition:background-color var(--duration-fast) var(--ease-standard)}
.db-chap.on{color:var(--brand-active);background:var(--brand-subtle);border-color:var(--brand-border)}
.db-chap.on i{background:var(--brand)}
.db-chap.done i{background:var(--success)}
@media (min-width:1024px){ .db-chapnav{top:88px} }

.db-mo{padding:38px 0 8px}
.db-eyebrow{display:flex;align-items:center;gap:9px;font-family:var(--font-ui);font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--brand);margin-bottom:12px}
.db-eyebrow-ln{flex:1;height:1px;background:var(--border)}

.db-reveal{background:radial-gradient(120% 140% at 0% 0%, var(--violet-100), transparent 55%), var(--surface);border:1px solid var(--brand-border);border-radius:var(--radius-2xl);box-shadow:var(--shadow-md);padding:26px;text-align:center;position:relative;overflow:hidden}
.db-rv-sub{font-family:var(--font-ui);font-size:12.5px;color:var(--text-muted);margin-bottom:18px}
.db-rv-band{margin-top:14px}
.db-rv-eyebrow{font-family:var(--font-ui);font-size:var(--text-2xs);font-weight:800;letter-spacing:var(--tracking-caps);text-transform:uppercase;color:var(--text-muted)}
.db-rv-n{font-family:var(--font-mono);font-size:38px;font-weight:600;color:var(--text-primary);line-height:1.2}
.db-rv-raw{font-family:var(--font-mono);font-size:var(--text-sm);color:var(--text-secondary)}
.db-rv-verdict{font-family:var(--font-ui);margin:18px auto 0;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:22ch;color:var(--text-primary);text-wrap:balance}
.db-rv-bar{height:12px;border-radius:var(--radius-full);background:var(--surface-inset);margin:18px auto 20px;max-width:380px;position:relative}
.db-rv-bar-f{position:absolute;left:0;top:0;bottom:0;border-radius:var(--radius-full);background:linear-gradient(90deg,var(--brand-active),var(--brand))}
.db-rv-bar-g{position:absolute;top:-5px;width:3px;height:22px;background:var(--gold-600);border-radius:2px;transform:translateX(-50%)}
.db-rv-bar-gl{position:absolute;top:-24px;transform:translateX(-50%);font-family:var(--font-ui);font-size:10px;font-weight:800;color:var(--warn-text);white-space:nowrap}
.db-rv-chips{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:6px}
.db-rv-chip{background:var(--surface-inset);border-radius:11px;padding:9px 14px;font-family:var(--font-ui);font-size:12px;font-weight:600;color:var(--text-muted)}
.db-rv-chip b{font-family:var(--font-mono);font-size:14px;color:var(--text-secondary);display:block}
.db-rv-go{display:inline-flex;align-items:center;gap:8px;margin-top:22px;background:var(--brand);color:var(--text-on-brand);font-weight:700;font-size:14px;border:0;border-radius:var(--radius-md);padding:12px 22px;cursor:pointer;font-family:var(--font-ui);min-height:44px}
.db-rv-go:hover{background:var(--brand-hover)}

.db-one{background:linear-gradient(150deg,var(--brand-active),var(--surface-premium));border-radius:var(--radius-2xl);color:#fff;padding:28px;text-align:center}
.db-one-h2{font-family:var(--font-ui);font-size:clamp(1.5rem,4vw,2rem);font-weight:800;letter-spacing:-.02em;color:#fff;max-width:22ch;margin:0 auto;text-wrap:balance}
.db-one-h2 em{font-style:normal;color:var(--gold-500)}
.db-one-sub{font-family:var(--font-ui);font-size:13.5px;color:rgba(255,255,255,.85);max-width:46ch;margin:12px auto 0;line-height:1.55}
.db-one-split{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:420px;margin:20px auto 0}
.db-one-cell{border-radius:14px;padding:14px;background:rgba(255,255,255,.12)}
.db-one-v{font-family:var(--font-mono);font-size:26px;font-weight:600}
.db-one-cell.g .db-one-v{color:#9FF0C8}
.db-one-cell.b .db-one-v{color:#FFB3B9}
.db-one-l{font-family:var(--font-ui);font-size:11.5px;font-weight:700;color:rgba(255,255,255,.8);margin-top:3px}
.db-one-prize{display:inline-flex;align-items:center;gap:8px;margin-top:18px;background:rgba(255,255,255,.16);border-radius:var(--radius-full);padding:8px 16px;font-family:var(--font-ui);font-size:13px;font-weight:800;color:var(--gold-500)}

.db-rep{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-2xl);box-shadow:var(--shadow-sm);padding:22px;position:relative;overflow:hidden}
.db-rep-perfect{font-family:var(--font-ui);font-size:var(--text-sm);color:var(--text-secondary);text-align:center;padding:12px 0}
.db-rep-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
.db-rep-title{font-family:var(--font-ui);font-size:16px;font-weight:800}
.db-rep-prog{font-family:var(--font-mono);font-size:12px;color:var(--text-muted)}
.db-rep-lead{font-family:var(--font-ui);font-size:13px;color:var(--text-muted);margin-bottom:14px}
.db-rep-chips{display:flex;flex-wrap:wrap;gap:8px}
.db-rep-chip{font-family:var(--font-mono);font-size:var(--text-xs);font-weight:600;color:var(--text-secondary);background:var(--surface-inset);border-radius:var(--radius-full);padding:6px 12px}
.db-rep-track{height:6px;border-radius:var(--radius-full);background:var(--surface-inset);overflow:hidden;margin-bottom:18px}
.db-rep-track i{display:block;height:100%;background:var(--brand);border-radius:var(--radius-full);transition:width .4s var(--ease-out)}
.db-rep-stamp{position:absolute;right:14px;top:14px;transform:rotate(-8deg);font-family:var(--font-ui);font-weight:800;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--success-text);border:3px solid var(--success-text);border-radius:10px;padding:6px 12px;background:color-mix(in oklab, var(--surface) 90%, transparent);pointer-events:none}
.db-rep-stamp small{display:block;font-family:var(--font-ui);font-size:8px;letter-spacing:.06em}

.db-gr-q{font-family:var(--font-reading);font-size:17px;color:var(--text-primary);line-height:1.5;margin-bottom:14px}
.db-gr-qn{font-family:var(--font-mono);font-size:12px;color:var(--brand);font-weight:600;margin-right:8px}
.db-gr-guess{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.db-gr-opt{font-family:var(--font-ui);font-weight:700;font-size:13.5px;border:1.5px solid var(--border);background:var(--surface);color:var(--text-secondary);padding:10px 16px;border-radius:11px;cursor:pointer;transition:var(--transition-colors);min-height:44px}
.db-gr-opt:hover:not(:disabled){border-color:var(--brand-border)}
.db-gr-opt:disabled{cursor:default}
.db-gr-opt.right{border-color:var(--success);background:var(--success-subtle);color:var(--success-text)}
.db-gr-opt.wrong{border-color:var(--error);background:var(--error-subtle);color:var(--error-text)}
.db-gr-reveal{border-top:1px solid var(--border-subtle);padding-top:13px}
.db-gr-verdict{font-family:var(--font-ui);font-weight:800;font-size:14px;margin-bottom:8px}
.db-gr-verdict.ok{color:var(--success-text)}
.db-gr-verdict.no{color:var(--error-text)}
.db-gr-why{display:flex;gap:8px;font-family:var(--font-ui);font-size:13px;color:var(--text-secondary);line-height:1.5;margin-bottom:10px}
.db-gr-ev{display:flex;gap:8px;font-family:var(--font-reading);font-size:13px;color:var(--reading-text);background:var(--reading-surface);border:1px solid var(--reading-rule);border-radius:10px;padding:11px 13px;line-height:1.55}
.db-gr-next{display:inline-flex;align-items:center;gap:7px;background:var(--brand);color:var(--text-on-brand);font-weight:700;font-size:13.5px;border:0;border-radius:11px;padding:11px 18px;cursor:pointer;font-family:var(--font-ui);margin-top:14px;min-height:44px}
.db-gr-next:hover{background:var(--brand-hover)}

.db-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,140%);opacity:0;pointer-events:none;background:var(--surface-inverse);color:var(--surface-inverse-ink);font-family:var(--font-ui);font-size:13.5px;font-weight:600;padding:12px 18px;border-radius:var(--radius-md);box-shadow:var(--shadow-md);transition:transform .3s var(--ease-out),opacity .3s;z-index:99;max-width:92vw}
.db-toast.show{transform:translate(-50%,0);opacity:1}

.db-upsell{margin-top:18px;border:1px solid var(--brand-border);background:var(--brand-subtle);border-radius:var(--radius-xl);padding:1.4rem 1.3rem;text-align:center}
.db-upsell-title{font-family:var(--font-ui);font-size:var(--text-lg);font-weight:800;color:var(--text-link)}
.db-upsell-text{font-family:var(--font-ui);color:var(--text-secondary);font-size:var(--text-sm);margin:.5rem auto 1rem;max-width:440px;line-height:1.5}

.db-lvl{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-2xl);box-shadow:var(--shadow-sm);padding:22px}
.db-lvl-h3{font-family:var(--font-ui);font-size:16px;font-weight:800;margin-bottom:4px;text-wrap:balance}
.db-lvl-lead{font-family:var(--font-ui);font-size:13px;color:var(--text-muted);margin-bottom:16px}
.db-lvl-lead b{color:var(--brand-active)}
.db-lvl-rows{padding-top:20px}
.db-lev-row{display:flex;align-items:center;gap:12px;padding:7px 0}
.db-lev-name{width:130px;flex:none;font-family:var(--font-ui);font-size:12.5px;font-weight:600;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.db-lev-track{flex:1;height:11px;border-radius:var(--radius-full);background:var(--surface-inset);position:relative}
.db-lev-fill{position:absolute;left:0;top:0;bottom:0;border-radius:var(--radius-full)}
.db-lev-avgline{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--brand);z-index:2;transform:translateX(-50%)}
.db-lev-avgtag{position:absolute;top:-22px;transform:translateX(-50%);font-family:var(--font-ui);font-size:9.5px;font-weight:800;color:var(--brand-active);white-space:nowrap}
.db-lev-score{width:40px;flex:none;text-align:right;font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--text-secondary)}
.db-lvl-note{display:flex;gap:10px;background:var(--brand-subtle);border:1px solid var(--brand-border);border-radius:var(--radius-md);padding:13px 16px;font-family:var(--font-ui);font-size:13px;color:var(--text-secondary);margin-top:14px;line-height:1.5}
.db-lvl-note b{color:var(--brand-active)}
.db-grow{display:flex;align-items:center;gap:14px;margin-top:16px;padding-top:14px;border-top:1px solid var(--border-subtle)}
.db-grow-bars{display:flex;align-items:flex-end;gap:8px;height:44px;flex:none}
.db-gb{display:flex;flex-direction:column;align-items:center;gap:4px;justify-content:flex-end}
.db-gb i{width:26px;display:block;border-radius:5px 5px 2px 2px;background:var(--brand-border)}
.db-gb:last-child i{background:var(--brand)}
.db-gb small{font-family:var(--font-mono);font-size:9.5px;color:var(--text-muted)}
.db-grow-txt{font-family:var(--font-ui);font-size:12.5px;color:var(--text-secondary);line-height:1.5}
.db-grow-txt b{color:var(--success-text)}

.db-next{background:var(--surface);border:1px solid var(--brand-border);border-radius:var(--radius-2xl);box-shadow:var(--shadow-md);padding:24px;text-align:center}
.db-next-h3{font-family:var(--font-ui);font-size:19px;font-weight:800;margin-bottom:6px}
.db-next-sub{font-family:var(--font-ui);font-size:13px;color:var(--text-muted);max-width:48ch;margin:0 auto 18px}
.db-plan{display:flex;flex-direction:column;gap:9px;max-width:430px;margin:0 auto 18px;text-align:left}
.db-pstep{display:flex;align-items:center;gap:12px;border:1px solid var(--border);border-radius:var(--radius-md);padding:12px 14px}
.db-pn{width:26px;height:26px;flex:none;border-radius:8px;display:grid;place-items:center;font-family:var(--font-mono);font-size:12px;font-weight:600;background:var(--brand-subtle);color:var(--brand-active)}
.db-pt{flex:1;font-family:var(--font-ui);font-size:13.5px;font-weight:700}
.db-pm{font-family:var(--font-mono);font-size:11px;color:var(--text-muted)}
.db-next-cta{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}

.db-share{margin:18px auto 0;max-width:430px;background:linear-gradient(150deg,var(--brand-active),var(--surface-premium));border-radius:var(--radius-lg);padding:16px;color:#fff;display:flex;flex-direction:column;gap:12px}
.db-share-top{display:flex;align-items:center;gap:14px;text-align:left}
.db-share-donut{width:54px;height:54px;flex:none;border-radius:50%;display:grid;place-items:center;position:relative}
.db-share-donut::before{content:"";position:absolute;inset:6px;border-radius:50%;background:var(--surface-premium)}
.db-share-donut b{position:relative;font-family:var(--font-mono);font-size:13px}
.db-share-text{flex:1;font-family:var(--font-ui);font-size:12.5px;line-height:1.45;color:rgba(255,255,255,.9)}

@media (pointer:coarse){
  .db-chap{min-height:44px}
}
@media (max-width:430px){
  .db-lev-name{width:96px}
}
@media (prefers-reduced-motion:reduce){
  .db-chap,.db-chap i,.db-rep-track i,.db-gr-opt,.db-gr-next,.db-toast{transition:none}
}
`;
