"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { Icon } from "@/components/core/icons";
import { Button } from "@/components/core/Button";
import { reviewCardAction } from "../actions";

/**
 * ReviewSession — клиентское тело одной сессии повторов (`/app/vocabulary/[deckId]`).
 * Локальная очередь: "good" убирает карту из сессии, "again" переставляет её в
 * конец (SM-2 стейт и дневной лимит — авторитетно на сервере, этот компонент
 * только гонит очередь и шлёт grade через готовый reviewCardAction).
 *
 * Тип карточки продублирован локально (не импортирован из server-only queries.ts,
 * который нельзя тянуть в client-бандл) — по паттерну PracticeCatalog: клиентский
 * компонент объявляет свою форму пропсов, а серверная page.tsx передаёт данные,
 * структурно совместимые с ней.
 */

type Grade = "again" | "good";

export interface ReviewCard {
  id: string;
  word: string;
  definition: string;
  example: string | null;
  translation: string | null;
  partOfSpeech: string | null;
  ipa: string | null;
}

interface ReviewSessionProps {
  cards: ReviewCard[];
  /** Всего карт к повтору в деке (может быть больше, чем длина cards — та ограничена лимитом батча). */
  dueCount: number;
  /** Остаток новых карт на сегодня (null = безлимит premium/ultra). */
  newRemainingToday: number | null;
  deckTitle: string;
}

export function ReviewSession({ cards, dueCount, newRemainingToday, deckTitle }: ReviewSessionProps) {
  const [total] = useState(cards.length);
  const [queue, setQueue] = useState(cards);
  const [flipped, setFlipped] = useState(false);
  const [pending, setPending] = useState(false);
  const [remaining, setRemaining] = useState(newRemainingToday);
  // Дневной кап мог быть уже исчерпан ДО открытия сессии (0 новых при заходе) —
  // тот же баннер тогда обслуживает и стартовое, и словленное в процессе состояние.
  const [dailyCapHit, setDailyCapHit] = useState(newRemainingToday === 0);
  const [errorHint, setErrorHint] = useState(false);
  const [transientMsg, setTransientMsg] = useState<string | null>(null);
  const [stats, setStats] = useState({ again: 0, good: 0 });

  const current = queue[0] ?? null;
  const completed = total - queue.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const finished = total > 0 && queue.length === 0;
  const neverHadCards = total === 0;

  const showAnswerRef = useRef<HTMLButtonElement>(null);

  // Фокус следует за состоянием, а не остаётся на скрытой (backface-hidden) грани:
  // новая карта (фронт) → "Show answer"; после флипа → "Again" (первая grade-кнопка,
  // найдена по id — Button не форвардит ref). WCAG 2.4.3 — фокус не теряется при смене.
  useEffect(() => {
    if (!current) return;
    if (flipped) {
      document.getElementById("rs-again-btn")?.focus();
    } else {
      showAnswerRef.current?.focus();
    }
  }, [current?.id, flipped]);

  // Транзиентное сообщение (tier/not_found) угасает само — тот же паттерн, что
  // GoalBar (practice/_PracticeCatalog.tsx) использует для "Saved"/"Error".
  useEffect(() => {
    if (!transientMsg) return;
    const id = setTimeout(() => setTransientMsg(null), 2600);
    return () => clearTimeout(id);
  }, [transientMsg]);

  async function submitGrade(grade: Grade) {
    const card = current;
    if (!card || pending) return;
    setPending(true);
    setErrorHint(false);
    try {
      const result = await reviewCardAction(card.id, grade);
      if (result.ok) {
        setRemaining(result.newRemainingToday);
        setStats((s) => ({ ...s, [grade]: s[grade] + 1 }));
        // "again" — в конец локальной очереди (interval 0, due немедленно, как задумано
        // SM-2 на сервере); "good" — карта покидает сессию.
        setQueue((q) => (grade === "again" ? [...q.slice(1), card] : q.slice(1)));
        setFlipped(false);
      } else if (result.reason === "daily_cap") {
        setDailyCapHit(true);
        setQueue((q) => q.slice(1));
        setFlipped(false);
      } else if (result.reason === "tier" || result.reason === "not_found") {
        setTransientMsg("That card is no longer available — moving on.");
        setQueue((q) => q.slice(1));
        setFlipped(false);
      } else {
        // "invalid" | "error" — карта остаётся на месте, юзер может повторить попытку.
        setErrorHint(true);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rs-wrap" style={S.wrap}>
      <style>{CSS}</style>

      <div>
        <Link href="/app/vocabulary" style={S.back}>
          <Icon name="arrow-left" size={15} strokeWidth={2.4} /> Back to decks
        </Link>
        <h1 style={S.title}>{deckTitle}</h1>
        <div style={S.headStats}>
          {dueCount > 0 && (
            <span style={S.stat}>
              <Icon name="clock" size={13} strokeWidth={2.4} /> {dueCount} due
            </span>
          )}
          {remaining !== null && (
            <span style={S.stat}>
              <Icon name="zap" size={13} strokeWidth={2.4} /> {remaining} new left today
            </span>
          )}
        </div>
      </div>

      {!finished && !neverHadCards && (
        <div
          style={S.progressRow}
          role="progressbar"
          aria-label="Session progress"
          aria-valuenow={completed}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuetext={`${completed} of ${total} reviewed`}
        >
          <span style={S.progressTrack}>
            <span style={{ ...S.progressFill, width: `${pct}%` }} />
          </span>
          <span style={S.progressLabel}>{completed} / {total}</span>
        </div>
      )}

      {/* Тихое SR-объявление для tier/not_found — карта уже убрана из DOM, юзер не
          должен теряться в догадках, почему очередь вдруг короче. */}
      <div aria-live="polite" style={S.srOnly}>{transientMsg}</div>

      {dailyCapHit && (
        <div style={S.capNotice}>
          <span style={S.capIcon}>
            <Icon name="lock" size={18} strokeWidth={2.4} />
          </span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={S.capTitle}>Daily new-card limit reached</div>
            <div style={S.capBody}>
              You&apos;ve started all the new cards Basic allows today. Reviews of cards
              you&apos;ve already seen aren&apos;t capped — upgrade for unlimited new cards
              every day.
            </div>
          </div>
          <Button href="/app/upgrade" size="sm" trailingIcon="arrow-right" style={{ flex: "none" }}>
            Upgrade
          </Button>
        </div>
      )}

      {neverHadCards || finished ? (
        <div style={S.summary}>
          <span style={S.summaryIcon}>
            <Icon name="circle-check" size={30} strokeWidth={2} />
          </span>
          {neverHadCards ? (
            <>
              <h2 style={S.summaryTitle}>All caught up</h2>
              <p style={S.summaryBody}>
                No cards are due right now in {deckTitle}. Check back later, or come back
                tomorrow for new ones.
              </p>
            </>
          ) : (
            <>
              <h2 style={S.summaryTitle}>Session complete</h2>
              <p style={S.summaryBody}>
                You reviewed {stats.again + stats.good} {stats.again + stats.good === 1 ? "card" : "cards"} in {deckTitle}.
              </p>
              <div style={S.summaryStats}>
                <div style={S.summaryStat}>
                  <span style={S.summaryStatVal}>{stats.good}</span>
                  <span style={S.summaryStatLab}>Good</span>
                </div>
                <div style={S.summaryStat}>
                  <span style={S.summaryStatVal}>{stats.again}</span>
                  <span style={S.summaryStatLab}>Again</span>
                </div>
              </div>
            </>
          )}
          <div style={S.summaryActions}>
            <Button href="/app/vocabulary" variant="secondary">Back to decks</Button>
            <Button onClick={() => window.location.reload()}>Review again</Button>
          </div>
        </div>
      ) : (
        current && (
          <>
            <div className={`rs-flip${flipped ? " is-flipped" : ""}`}>
              <div className="rs-flip-inner">
                <div className="rs-face rs-face-front" aria-hidden={flipped || undefined}>
                  <div style={S.word}>{current.word}</div>
                  {current.ipa && <div style={S.ipa}>{current.ipa}</div>}
                  {current.partOfSpeech && <span style={S.pos}>{current.partOfSpeech}</span>}
                  {/* Флип-триггер — обычная кнопка: клик/тап/Enter/Space работают из
                      коробки, без выдуманных aria-pressed/aria-expanded. Уходит из
                      таб-порядка и из a11y-дерева, когда грань перевёрнута назад
                      (CSS backface-visibility её только визуально прячет). */}
                  <button
                    type="button"
                    ref={showAnswerRef}
                    onClick={() => setFlipped(true)}
                    tabIndex={flipped ? -1 : 0}
                    aria-hidden={flipped || undefined}
                    style={S.flipBtn}
                  >
                    Show answer
                  </button>
                </div>
                <div className="rs-face rs-face-back" aria-hidden={!flipped || undefined}>
                  <div style={S.definition}>{current.definition}</div>
                  {current.example && <p style={S.example}><em>{current.example}</em></p>}
                  {current.translation && <div style={S.translation}>{current.translation}</div>}
                </div>
              </div>
            </div>

            {flipped && (
              <div style={S.actions}>
                <Button
                  id="rs-again-btn"
                  variant="secondary"
                  size="lg"
                  disabled={pending}
                  onClick={() => submitGrade("again")}
                  style={{ flex: 1 }}
                >
                  Again
                </Button>
                <Button
                  variant="success"
                  size="lg"
                  disabled={pending}
                  onClick={() => submitGrade("good")}
                  style={{ flex: 1 }}
                >
                  Good
                </Button>
              </div>
            )}
            {errorHint && (
              <div role="alert" style={S.errorHint}>
                Couldn&apos;t save that — check your connection and try again.
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}

/* Флип — стандартный 3D-приём (perspective + preserve-3d + backface-visibility).
   Единственный transition — сам rotateY; глобальный @media(prefers-reduced-motion)
   в tokens/base.css уже гасит ЛЮБОЙ transition-duration до ~0, так что смена грани
   становится мгновенной без своего дублирующего media-query (мгновенная смена без
   3D-вращения — ровно то, что просит инвариант reduced-motion). */
const CSS = `
.rs-flip{perspective:1200px}
.rs-flip-inner{position:relative;min-height:230px;transform-style:preserve-3d;transition:transform var(--duration-deliberate) var(--ease-in-out)}
.rs-flip.is-flipped .rs-flip-inner{transform:rotateY(180deg)}
.rs-face{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;padding:26px 22px;border-radius:var(--radius-xl);border:2px solid var(--border);background:var(--surface);box-shadow:var(--shadow-solid);overflow-y:auto;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.rs-face-back{transform:rotateY(180deg)}
@media (min-width:768px){
  .rs-flip-inner{min-height:270px}
}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 640, margin: "0 auto", padding: "24px 16px 64px", display: "flex", flexDirection: "column", gap: 18, fontFamily: "var(--font-ui)" },
  back: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--text-muted)", textDecoration: "none" },
  title: { margin: "10px 0 0", fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  headStats: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 },
  stat: { display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: "var(--radius-full)", background: "var(--surface-inset)", color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 700 },

  progressRow: { display: "flex", alignItems: "center", gap: 12 },
  progressTrack: { position: "relative", flex: 1, display: "block", height: 8, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden" },
  progressFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  progressLabel: { flex: "none", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" },

  srOnly: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 },

  capNotice: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 14, padding: "15px 18px", background: "color-mix(in oklab, var(--warn) 7%, var(--surface))", border: "2px solid color-mix(in oklab, var(--warn) 38%, var(--border))", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)" },
  capIcon: { width: 42, height: 42, flex: "none", borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: "var(--warn-subtle)", color: "var(--warn-text)" },
  capTitle: { fontSize: 15, fontWeight: 800, color: "var(--text-primary)" },
  capBody: { fontSize: 13, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 },

  word: { fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  ipa: { fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-muted)" },
  pos: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-link)", background: "var(--brand-subtle)", padding: "3px 10px", borderRadius: "var(--radius-full)" },
  flipBtn: { marginTop: 14, appearance: "none", cursor: "pointer", padding: "10px 20px", borderRadius: "var(--radius-md)", border: "2px solid var(--brand-border)", background: "var(--brand-subtle)", color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800 },
  definition: { fontSize: 17, lineHeight: 1.5, color: "var(--text-primary)", fontWeight: 600 },
  example: { margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--text-muted)" },
  translation: { fontSize: 15, fontWeight: 700, color: "var(--text-link)" },

  actions: { display: "flex", gap: 12 },
  errorHint: { textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--error-text)" },

  summary: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, padding: "40px 24px", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-solid)" },
  summaryIcon: { display: "grid", placeItems: "center", width: 56, height: 56, borderRadius: "50%", background: "var(--success-subtle)", color: "var(--success-text)", marginBottom: 4 },
  summaryTitle: { margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text-primary)" },
  summaryBody: { margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--text-muted)", maxWidth: "42ch" },
  summaryStats: { display: "flex", gap: 28, marginTop: 6 },
  summaryStat: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  summaryStatVal: { fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 800, color: "var(--text-primary)" },
  summaryStatLab: { fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" },
  summaryActions: { display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap", justifyContent: "center" },
};
