"use client";

/**
 * Insight-report interactivity: AnswerKeyFilter — All / Wrong only / per-type
 * chips with a FLIP relayout, rendered as the /result answer-key appendix.
 *
 * answer_key gating is preserved upstream: when the review is gated the server
 * omits `answer`/`explanation`/`evidence` from the items, so they never reach
 * this client component or the HTML. Final state is the rendered default; every
 * animation is WAAPI on top and is skipped under prefers-reduced-motion.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Icon } from "@/components/core/icons";

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;
const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ========================================================= Answer-key filter */

export interface AKItem {
  number: number;
  qtype: string;
  label: string;
  correct: boolean;
  given: string;
  /** Generic per-type strategy (labels.ts qtypeDescription) — always present,
   *  not gated (coach ak-list reference; rendering lands in the ak-list rescin). */
  strategy: string;
  /** Present only when the full review is unlocked (server-gated). */
  answer?: string;
  explanation?: string | null;
  evidence?: string | null;
}
export interface AKType {
  type: string;
  label: string;
}

export function AnswerKeyFilter({ items, types }: { items: AKItem[]; types: AKType[] }) {
  const [filter, setFilter] = useState<string>("all");
  const listRef = useRef<HTMLDivElement>(null);
  const prev = useRef<Map<number, DOMRect>>(new Map());

  const shown =
    filter === "all"
      ? items
      : filter === "wrong"
        ? items.filter((q) => !q.correct)
        : items.filter((q) => q.qtype === filter);

  // FLIP: survivors slide from their previous box, newcomers fade up.
  useIso(() => {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>("[data-n]");
    if (!reduced() && nodes) {
      nodes.forEach((n) => {
        const num = Number(n.dataset.n);
        const r = n.getBoundingClientRect();
        const p = prev.current.get(num);
        if (p) {
          const dx = p.left - r.left;
          const dy = p.top - r.top;
          if (dx || dy) {
            n.animate(
              [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
              { duration: 420, easing: EASE_OUT },
            );
          }
        } else {
          n.animate(
            [{ opacity: 0, transform: "translateY(10px) scale(0.98)" }, { opacity: 1, transform: "none" }],
            { duration: 360, easing: EASE_OUT, fill: "backwards" },
          );
        }
      });
    }
    const m = new Map<number, DOMRect>();
    nodes?.forEach((n) => m.set(Number(n.dataset.n), n.getBoundingClientRect()));
    prev.current = m;
  }, [filter]);

  const chips: AKType[] = [
    { type: "all", label: "All" },
    { type: "wrong", label: "Wrong only" },
    ...types,
  ];

  return (
    <div>
      <style>{IR_CSS}</style>
      <div className="ir-chips" style={S.chips} role="group" aria-label="Filter answers">
        {chips.map((c) => (
          <button
            key={c.type}
            type="button"
            aria-pressed={filter === c.type}
            className={`ir-chip${filter === c.type ? " on" : ""}`}
            style={filter === c.type ? { ...S.chip, ...S.chipOn } : S.chip}
            onClick={() => setFilter(c.type)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div ref={listRef} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.length === 0 ? (
          <div style={S.empty}>Nothing here — every question of this type is correct. 🎉</div>
        ) : (
          shown.map((q) => <ReviewCard key={q.number} q={q} />)
        )}
      </div>
    </div>
  );
}

function ReviewCard({ q }: { q: AKItem }) {
  return (
    <article data-n={q.number} style={S.rev}>
      <div style={S.revHead}>
        <span style={{ ...S.revMark, background: q.correct ? "var(--success-subtle)" : "var(--error-subtle)", color: q.correct ? "var(--success-text)" : "var(--error-text)" }}>
          <Icon name={q.correct ? "check" : "x"} size={14} />
        </span>
        <span style={S.revNum}>Q{q.number}</span>
        <span style={S.revType}>{q.label}</span>
      </div>
      <div className="ir-revlines" style={S.revLines}>
        <div style={{ minWidth: 0 }}>
          <span style={S.revLabel}>You </span>
          <b style={{ color: q.correct ? "var(--success-text)" : "var(--error-text)", overflowWrap: "anywhere" }}>{q.given}</b>
        </div>
        {!q.correct && q.answer != null && (
          <div style={{ minWidth: 0 }}>
            <span style={S.revLabel}>Answer </span>
            <b style={{ color: "var(--text-primary)", overflowWrap: "anywhere" }}>{q.answer}</b>
          </div>
        )}
      </div>
      {q.explanation && (
        <div style={S.expl}>
          <Icon name="lightbulb" size={14} style={{ color: "var(--warn-text)", marginTop: 2, flex: "none" }} />
          <span>{q.explanation}</span>
        </div>
      )}
      {q.evidence && (
        <div style={S.evidence}>
          <Icon name="book-open" size={15} style={{ color: "var(--reading-muted)", marginTop: 2, flex: "none" }} />
          <span>“{q.evidence}”</span>
        </div>
      )}
    </article>
  );
}

/* Interactive/responsive bits live in classes (inline can't do :hover/media and
   would override breakpoint rules — see the responsive-inline-class invariant). */
const IR_CSS = `
.ir-chip:hover{color:var(--text-primary)}
@media (pointer:coarse){
  .ir-chip{min-height:44px}
}
/* Длинный ответ без пробелов может распереть ряд "You / Answer" даже с overflow-wrap
   на узких телефонах — разрешаем перенос строк как последнюю страховку. */
@media (max-width:430px){
  .ir-revlines{flex-wrap:wrap}
}
`;

const S: Record<string, CSSProperties> = {
  chips: { display: "flex", gap: 6, background: "var(--surface-inset)", padding: 4, borderRadius: "var(--radius-md)", flexWrap: "wrap" },
  chip: { display: "inline-flex", alignItems: "center", justifyContent: "center", border: 0, background: "transparent", fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-xs)", color: "var(--text-muted)", padding: "7px 12px", borderRadius: 10, cursor: "pointer" },
  chipOn: { background: "var(--surface)", color: "var(--text-primary)", boxShadow: "var(--shadow-sm)" },

  empty: { padding: 24, textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },

  rev: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)" },
  revHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  revMark: { width: 24, height: 24, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" },
  revNum: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },
  revType: { fontFamily: "var(--font-reading)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },
  revLines: { display: "flex", gap: 18, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", marginBottom: 10 },
  revLabel: { color: "var(--text-muted)" },
  expl: { display: "flex", gap: 8, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: "var(--leading-relaxed)" },
  evidence: { marginTop: 10, display: "flex", gap: 8, fontFamily: "var(--font-reading)", fontSize: "var(--text-sm)", color: "var(--reading-text)", background: "var(--reading-surface)", border: "1px solid var(--reading-rule)", borderRadius: "var(--radius-md)", padding: "10px 12px" },
};
