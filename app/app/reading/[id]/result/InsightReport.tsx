"use client";

/**
 * Insight-report interactivity: AnswerKeyFilter — sticky filter chips over a
 * grouped, expandable answer-key list (the coach "Answer key" tab).
 *
 * answer_key gating is preserved upstream: when the review is gated the server
 * omits `answer`/`explanation`/`evidence` from the items, so they never reach
 * this client component or the HTML. `strategy` (a generic per-type pointer,
 * labels.ts qtypeDescription) is NOT gated — it always renders, unlike the
 * gated real `evidence` line (which falls back to a dashed placeholder).
 * Final state is the rendered default; every animation is WAAPI/CSS on top and
 * is skipped under prefers-reduced-motion.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
   *  not gated (coach ak-list reference; distinct from the gated real evidence). */
  strategy: string;
  /** Present only when the full review is unlocked (server-gated). */
  answer?: string;
  evidence?: string | null;
  /** RU-объяснение (L1-слой, 0050) — тот же гейт, что answer/evidence. */
  explanationRu?: string | null;
}
export interface AKType {
  type: string;
  label: string;
}

export function AnswerKeyFilter({
  items,
  types,
  filter: filterProp,
  onFilterChange,
}: {
  items: AKItem[];
  types: AKType[];
  /**
   * Controlled active chip — lets another tab (coach "By type") jump straight
   * into a pre-filtered view. Uncontrolled (internal state, default "wrong" —
   * screen is built around misses, matches result-coach.html:484 — falling
   * back to "all" only when there are none) when omitted — the props/gate
   * contract of items/types is unchanged.
   */
  filter?: string;
  onFilterChange?: (filter: string) => void;
}) {
  const [internalFilter, setInternalFilter] = useState(() => (items.some((q) => !q.correct) ? "wrong" : "all"));
  const filter = filterProp ?? internalFilter;
  const setFilter = (f: string) => (onFilterChange ? onFilterChange(f) : setInternalFilter(f));
  const [open, setOpen] = useState<Set<number>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const prev = useRef<Map<number, DOMRect>>(new Map());

  const shown =
    filter === "all"
      ? items
      : filter === "wrong"
        ? items.filter((q) => !q.correct)
        : items.filter((q) => q.qtype === filter);

  // Per-type correct/total, over ALL items (not just the filtered subset) —
  // the ak-group header shows the type's real standing regardless of filter.
  const typeCounts = useMemo(() => {
    const m = new Map<string, { correct: number; total: number }>();
    for (const q of items) {
      const e = m.get(q.qtype) ?? { correct: 0, total: 0 };
      e.total++;
      if (q.correct) e.correct++;
      m.set(q.qtype, e);
    }
    return m;
  }, [items]);
  // Group headers only make sense when several types are mixed together (all/wrong).
  const grouped = filter === "all" || filter === "wrong";

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

  const chips: (AKType & { n: number })[] = [
    { type: "all", label: "All", n: items.length },
    { type: "wrong", label: "Wrong only", n: items.filter((q) => !q.correct).length },
    ...types.map((t) => ({ ...t, n: typeCounts.get(t.type)?.total ?? 0 })),
  ];

  const toggle = (n: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  let lastType: string | null = null;

  return (
    <div>
      <style>{AK_CSS}</style>
      <div className="ak-filter" role="group" aria-label="Filter answers">
        {chips.map((c) => (
          <button
            key={c.type}
            type="button"
            aria-pressed={filter === c.type}
            className={`chip${filter === c.type ? " on" : ""}`}
            onClick={() => setFilter(c.type)}
          >
            {c.label}
            <span className="c">{c.n}</span>
          </button>
        ))}
      </div>
      <div ref={listRef} className="ak-list">
        {shown.length === 0 ? (
          <div className="ak-group">Nothing here — every question of this type is correct. 🎉</div>
        ) : (
          shown.map((q) => {
            const showGroupHeader = grouped && q.qtype !== lastType;
            lastType = q.qtype;
            const counts = typeCounts.get(q.qtype);
            return (
              <div key={q.number} data-n={q.number}>
                {showGroupHeader && (
                  <div className="ak-group">
                    {q.label}
                    <span className="gc">{counts ? `${counts.correct}/${counts.total}` : ""}</span>
                  </div>
                )}
                <AKRow q={q} isOpen={open.has(q.number)} onToggle={() => toggle(q.number)} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function AKRow({ q, isOpen, onToggle }: { q: AKItem; isOpen: boolean; onToggle: () => void }) {
  const detailId = `ak-detail-${q.number}`;
  // Свёрнут по умолчанию (сбрасывается при повторном открытии строки — EN
  // остаётся основной методикой, RU только по явному запросу).
  const [ruOpen, setRuOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`ak-row${q.correct ? "" : " wrong"}${isOpen ? " open" : ""}`}
        aria-expanded={isOpen}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <span className={`ak-mark ${q.correct ? "ok" : "no"}`} aria-hidden="true">{q.correct ? "✓" : "✕"}</span>
        <span className="ak-mid">
          <span className="ak-q">
            <span className="ak-qn">Q{q.number}</span>
            <span className="ak-type">{q.label}</span>
          </span>
          <span className="ak-ans">
            <span><span className="yq">You</span> {q.given === "—" ? <span className="dash">— skipped</span> : <span className={q.correct ? "you-r" : "you-w"}>{q.given}</span>}</span>
            {!q.correct && q.answer != null && (
              <span><span className="yq">Answer</span> <span className="key">{q.answer}</span></span>
            )}
          </span>
        </span>
        <span className="ak-chev" aria-hidden="true">›</span>
      </button>
      {isOpen && (
        <div className="ak-detail" id={detailId}>
          <div className="ak-strat">💡 <span>{q.strategy}</span></div>
          {q.evidence ? (
            <div className="ev">📖 <span>{q.evidence}</span></div>
          ) : (
            <div className="ak-evstub">
              The passage line that proves this is shown here in your real result, highlighted in the reading view.
            </div>
          )}
          {q.explanationRu && (
            <div className="ak-ru">
              <button
                type="button"
                className="ak-ru-toggle"
                aria-expanded={ruOpen}
                onClick={() => setRuOpen((o) => !o)}
              >
                <span className="ak-ru-badge">RU</span>
                {ruOpen ? "Hide" : "Explain in Russian"}
              </button>
              {ruOpen && <p className="ak-ru-text">{q.explanationRu}</p>}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* Interactive/responsive bits live in classes (inline can't do :hover/media and
   would override breakpoint rules — see the responsive-inline-class invariant).
   Sticky offsets clear the app header + coach tab bar (top:60/88 header pattern,
   see Annotations.tsx/_Transcript.tsx "top:88 clears the sticky header"). */
const AK_CSS = `
/* top клирит rc-tabs (coach tab bar) под ним — значение зависит от метрик
   шрифта/паддингов таб-бара, финальная сверка визуально на проде после
   деплоя (coach ui pass, ~134/162 против прежних 114/142). */
.ak-filter{position:sticky;top:134px;z-index:19;display:flex;gap:7px;overflow-x:auto;padding:6px 0 12px;scrollbar-width:none;background:color-mix(in oklab, var(--bg-base) 92%, transparent);backdrop-filter:blur(6px)}
.ak-filter::-webkit-scrollbar{display:none}
@media (min-width:1024px){ .ak-filter{top:162px} }
.chip{flex:none;font-family:var(--font-ui);font-size:12.5px;font-weight:700;color:var(--text-secondary);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:8px 15px;cursor:pointer;white-space:nowrap;transition:var(--transition-colors);min-height:36px}
.chip .c{font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-left:5px}
.chip:hover{border-color:var(--brand-border)}
.chip.on{background:var(--brand);color:#fff;border-color:var(--brand)}
.chip.on .c{color:color-mix(in oklab, #fff 75%, transparent)}

.ak-list{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow-sm)}
.ak-group{display:flex;align-items:center;gap:10px;padding:11px 18px;font-family:var(--font-ui);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);background:var(--surface-inset);border-top:1px solid var(--border-subtle)}
div[data-n]:first-child .ak-group{border-top:0}
.ak-group .gc{margin-left:auto;font-family:var(--font-mono);font-size:11px;font-weight:700;letter-spacing:0;text-transform:none}

.ak-row{width:100%;display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:14px;padding:13px 18px;border-top:1px solid var(--border-subtle);border-left:0;border-right:0;border-bottom:0;background:var(--surface);cursor:pointer;transition:background .12s var(--ease-standard);text-align:left;font-family:inherit}
div[data-n]:first-child > .ak-row{border-top:0}
.ak-row:hover{background:var(--surface-hover)}
.ak-row.wrong{background:linear-gradient(90deg,var(--error-subtle),transparent 42%)}
.ak-row.wrong:hover{background:linear-gradient(90deg,color-mix(in oklab, var(--error-subtle) 80%, var(--error)),transparent 46%)}
.ak-mark{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:14px;font-weight:700;flex:none}
.ak-mark.ok{background:var(--success-subtle);color:var(--success-text)}
.ak-mark.no{background:var(--error-subtle);color:var(--error-text)}
.ak-mid{min-width:0;display:flex;flex-direction:column;gap:5px}
.ak-q{display:flex;align-items:center;gap:9px;font-family:var(--font-ui);font-size:12px}
.ak-qn{font-family:var(--font-mono);font-weight:700;color:var(--brand-active)}
.ak-type{color:var(--text-muted);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ak-ans{display:flex;flex-wrap:wrap;gap:5px 16px;font-family:var(--font-ui);font-size:13.5px}
.ak-ans .yq{color:var(--text-muted)}
.ak-ans .you-w{color:var(--error-text);font-weight:700}
.ak-ans .you-r{color:var(--success-text);font-weight:700}
.ak-ans .key{color:var(--text-primary);font-weight:700}
.ak-ans .dash{color:var(--text-disabled)}
.ak-chev{margin-left:auto;color:var(--text-disabled);font-size:20px;line-height:1;flex:none;transition:transform .2s var(--ease-standard),color .15s}
.ak-row:hover .ak-chev{color:var(--text-muted)}
.ak-row.open .ak-chev{transform:rotate(90deg);color:var(--brand-active)}

.ak-detail{display:flex;flex-direction:column;gap:10px;padding:2px 18px 16px 62px;background:var(--surface)}
.ak-strat{display:flex;gap:10px;font-family:var(--font-ui);font-size:13.5px;color:var(--text-secondary);line-height:1.55}
.ak-strat b{color:var(--text-primary)}
.ev{display:flex;gap:11px;font-family:var(--font-reading);font-size:14px;color:var(--reading-text);background:var(--reading-surface);border:1px solid var(--reading-rule);border-radius:12px;padding:14px 16px;line-height:1.6}
/* .ev mark сознательно не портирован из прототипа: evidence рендерится как
   плоский текст (React text child, не dangerouslySetInnerHTML) — <mark> в
   данных нет и не может отрендериться, правило было бы мёртвым CSS. */
.ak-evstub{font-family:var(--font-ui);font-size:12.5px;color:var(--text-muted);font-style:italic;padding:11px 13px;border:1px dashed var(--border);border-radius:10px;line-height:1.5}
/* RU-объяснение (L1-слой, 0050) — свёрнутый по умолчанию тумблер. */
.ak-ru-toggle{display:inline-flex;align-items:center;gap:7px;min-height:32px;padding:2px 0;border:none;background:none;color:var(--text-muted);font-family:var(--font-ui);font-size:13.5px;font-weight:700;cursor:pointer;transition:var(--transition-colors)}
.ak-ru-toggle:hover{color:var(--text-secondary)}
.ak-ru-badge{font-family:var(--font-mono);font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--brand-active);background:var(--brand-subtle);border-radius:5px;padding:2px 5px}
.ak-ru-text{margin:6px 0 0;font-family:var(--font-ui);font-size:13.5px;line-height:1.6;color:var(--text-secondary)}
@media (pointer:coarse){.ak-ru-toggle{min-height:44px}}

@media (pointer:coarse){
  .chip{min-height:44px}
}
@media (max-width:430px){
  .ak-row{grid-template-columns:28px 1fr}
  .ak-chev{grid-column:3;grid-row:1}
  .ak-detail{padding-left:18px}
  /* Ряд chip-фильтров скроллится (overflow-x:auto + скрытый scrollbar), но обрезался
     у правого края без намёка, что есть ещё контент — тот же fade, что у rc-seg. */
  .ak-filter{-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 22px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 22px),transparent)}
}
@media (prefers-reduced-motion:reduce){
  .chip,.ak-row,.ak-chev{transition:none}
}
`;
