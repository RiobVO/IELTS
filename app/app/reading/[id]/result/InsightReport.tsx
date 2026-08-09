"use client";

/**
 * Insight-report interactivity (variant A). Two client islands over server data:
 *  - AccuracyByType: tap a type to expand WHICH questions you missed (chips come
 *    from already-loaded per-question data — no extra queries, perf-safe).
 *  - AnswerKeyFilter: All / Wrong only / per-type chips with a FLIP relayout.
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
import Link from "next/link";
import { Icon } from "@/components/core/icons";

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;
const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const barColor = (p: number) =>
  p < 45 ? "var(--error)" : p < 70 ? "var(--warn)" : "var(--success)";
const barText = (p: number) =>
  p < 45 ? "var(--error-text)" : p < 70 ? "var(--warn-text)" : "var(--success-text)";

/* ======================================================= Accuracy by type */

export interface AccRow {
  type: string;
  label: string;
  correct: number;
  total: number;
  weak: boolean;
  missed: number[];
  got: number[];
  practiseHref: string;
}

export function AccuracyByType({ rows }: { rows: AccRow[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);

  // Bars grow worst-first on mount (rows arrive pre-sorted weakest → strongest).
  useEffect(() => {
    if (reduced()) return;
    const fills = ref.current?.querySelectorAll<HTMLElement>("[data-grow]");
    const anims: Animation[] = [];
    fills?.forEach((el, i) => {
      el.style.transformOrigin = "left center";
      anims.push(
        el.animate(
          [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
          { duration: 620, delay: 300 + i * 90, easing: EASE_OUT, fill: "backwards" },
        ),
      );
    });
    return () => anims.forEach((a) => a.cancel());
  }, []);

  return (
    <div className="ir-card" style={S.card} ref={ref}>
      <style>{IR_CSS}</style>
      <h2 style={S.cardTitle}>
        Accuracy by question type{" "}
        <span aria-hidden="true" style={S.cardHint}>· tap to see what you missed</span>
      </h2>
      <div>
        {rows.map((r, i) => {
          const p = Math.round((r.correct / r.total) * 100);
          const isOpen = !!open[r.type];
          const panelId = `acc-panel-${i}`;
          return (
            <div key={r.type} className={`ir-row${isOpen ? " open" : ""}`}>
              <button
                type="button"
                className="ir-head"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen((o) => ({ ...o, [r.type]: !o[r.type] }))}
              >
                <span className="ir-accname" style={S.accName}>
                  <span style={S.accLabel}>{r.label}</span>
                  {r.weak && <span style={S.weak}>WEAKEST</span>}
                </span>
                <span style={S.track}>
                  <span data-grow style={{ display: "block", height: "100%", width: `${Math.max(p, 2)}%`, borderRadius: "var(--radius-full)", background: barColor(p) }} />
                </span>
                <span style={{ ...S.accScore, color: barText(p) }}>
                  {r.correct}/{r.total}
                </span>
                <span className="ir-chev" style={S.chev}>
                  <Icon name="chevron-down" size={18} />
                </span>
              </button>
              <div className="ir-panel" id={panelId}>
                <div>
                  <div style={S.panelIn}>
                    <p style={S.missLead}>
                      {r.missed.length} missed
                      {r.got.length ? ` · ${r.got.length} correct` : ""} — drill the
                      misses below.
                    </p>
                    <div style={S.chipWrap}>
                      {r.missed.map((n) => (
                        <span key={`m${n}`} style={{ ...S.qchip, background: "var(--error-subtle)", color: "var(--error-text)" }}>
                          Q{n}
                        </span>
                      ))}
                      {r.got.map((n) => (
                        <span key={`g${n}`} style={{ ...S.qchip, background: "var(--success-subtle)", color: "var(--success-text)" }}>
                          Q{n} ✓
                        </span>
                      ))}
                    </div>
                    <Link href={r.practiseHref} className="ir-practise" style={S.practiseBtn}>
                      Practise {r.label}
                      <Icon name="arrow-right" size={15} strokeWidth={2.5} />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ========================================================= Answer-key filter */

export interface AKItem {
  number: number;
  qtype: string;
  label: string;
  correct: boolean;
  given: string;
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
.ir-row{border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;transition:border-color .2s,box-shadow .2s}
.ir-row+.ir-row{margin-top:10px}
.ir-row.open{border-color:var(--brand-border);box-shadow:var(--shadow-sm)}
.ir-head{display:flex;align-items:center;gap:14px;width:100%;border:0;background:transparent;text-align:left;padding:13px 15px;min-height:44px;cursor:pointer;font:inherit;color:inherit}
.ir-head:hover{background:var(--surface-inset)}
.ir-accname{width:120px}
.ir-chev{transition:transform .25s var(--ease-out)}
.ir-row.open .ir-chev{transform:rotate(180deg)}
.ir-panel{display:grid;grid-template-rows:0fr;transition:grid-template-rows .3s var(--ease-out)}
.ir-row.open .ir-panel{grid-template-rows:1fr}
/* visibility:hidden (not just clipped height) pulls the collapsed panel — and
   its Practise link — out of the tab order / a11y tree; reveals on open. */
.ir-panel>div{overflow:hidden;visibility:hidden;transition:visibility .3s}
.ir-row.open .ir-panel>div{visibility:visible}
.ir-practise:hover{filter:brightness(0.97)}
.ir-chip:hover{color:var(--text-primary)}
@media (min-width:560px){ .ir-accname{width:190px} }
@media (pointer:coarse){
  .ir-chip{min-height:44px}
  .ir-practise{min-height:44px}
}
@media (prefers-reduced-motion:reduce){
  .ir-chev,.ir-panel,.ir-panel>div{transition:none}
}
/* Длинный ответ без пробелов может распереть ряд "You / Answer" даже с overflow-wrap
   на узких телефонах — разрешаем перенос строк как последнюю страховку. */
@media (max-width:430px){
  .ir-revlines{flex-wrap:wrap}
}
`;

const S: Record<string, CSSProperties> = {
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)", padding: "20px 22px", marginBottom: 14 },
  cardTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--text-primary)", margin: "0 0 14px" },
  cardHint: { fontWeight: 500, color: "var(--text-muted)", fontSize: "var(--text-sm)" },

  accName: { flex: "none", display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" },
  accLabel: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  weak: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--error-text)", background: "var(--error-subtle)", padding: "2px 7px", borderRadius: "var(--radius-full)", flex: "none" },
  track: { flex: 1, height: 9, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden" },
  accScore: { width: 44, flex: "none", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 600 },
  chev: { flex: "none", color: "var(--text-muted)", display: "inline-flex" },

  panelIn: { padding: "2px 15px 15px" },
  missLead: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: "0 0 10px" },
  chipWrap: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  qchip: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", fontWeight: 600, padding: "4px 9px", borderRadius: "var(--radius-full)" },
  practiseBtn: { display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-primary)", background: "var(--surface)", border: "1px solid var(--border-strong)", boxShadow: "var(--shadow-solid)", padding: "9px 14px", borderRadius: "var(--radius-md)", textDecoration: "none" },

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
