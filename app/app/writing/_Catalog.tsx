"use client";

import { memo, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Input } from "@/components/core/Input";
import type { CatalogTask } from "@/lib/writing/read";
import {
  writingDifficultyLabel,
  writingTaskTypeLabel,
  writingTopicLabel,
  type WritingTopic,
} from "@/lib/writing/topic-meta";

/**
 * WritingCatalog — клиентское тело каталога Writing Lab (handoff: Prompt Catalog).
 * Богатые карточки промтов: topic (цвет + иконка), difficulty-meter, текст вопроса,
 * type-tag, band-range, время. Фасетные фильтры (task / category / difficulty) + поиск +
 * сортировка; сервер (`page.tsx`) передаёт уже опубликованные темы. Карточки с неполными
 * метаданными (legacy до бэкфилла) мягко деградируют в нейтральный вид.
 *
 * Цвет темы — намеренный визуальный якорь (4 носителя на карту), сами значения живут в
 * `colors.css` как `--topic-*` токены. Текстовые подписи — UI-font sentence-case ≥12px;
 * mono+caps оставлены цифрам. Помощь — tap-friendly `<details>`. Список фильтруется/сортируется
 * в одном `useMemo`, карта обёрнута в `memo` — печать в поиске не перерисовывает всю сетку.
 */

type CatFilter = "all" | "academic" | "general";
type PartFilter = "all" | "task1" | "task2";
type DiffFilter = "all" | "1" | "2" | "3";
type Sort = "default" | "difficulty" | "band";

const SEGMENTS: { value: CatFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "academic", label: "Academic" },
  { value: "general", label: "General" },
];
// Task 1 (chart, 150 words, ~20 min) vs Task 2 (essay, 250 words, ~40 min) — distinct
// formats, so the catalog lets the user train one. Client-side filter, same as category.
const PART_SEGMENTS: { value: PartFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "task1", label: "Task 1" },
  { value: "task2", label: "Task 2" },
];
// Difficulty filter — the audience picks by level, so this is the highest-value facet
// (labels mirror the on-card meter + the help disclosure). Values are the 1/2/3 tier.
const DIFF_SEGMENTS: { value: DiffFilter; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "1", label: "Foundation" },
  { value: "2", label: "Core" },
  { value: "3", label: "Stretch" },
];

const MINUTES = 40;
const EN_DASH = "–";

/**
 * Topic glyphs (handoff §Design Tokens). Colours moved to `colors.css` as `--topic-*`
 * tokens; only the inline SVG path stays here (it's geometry, not colour). Resolved by
 * the topic key → `var(--topic-${key}-color|ink|tint|tint-border)`.
 */
const TOPIC_ICON: Record<WritingTopic, string> = {
  society:
    "M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 20v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8",
  environment: "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z M2 21c0-3 1.9-5.4 5.1-6",
  crime: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  technology:
    "M5 5h14v14H5z M9 9h6v6H9z M9 1v3 M15 1v3 M9 20v3 M15 20v3 M1 9h3 M1 15h3 M20 9h3 M20 15h3",
  food: "M4 2v6a2 2 0 0 0 4 0V2 M6 2v20 M18 2c-1.7 0-3 2-3 5v5h3 M18 2v20",
  culture: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M2 12h20 M12 2a14 14 0 0 1 0 20 14 14 0 0 1 0-20Z",
};

export function WritingCatalog({ tasks, targetBand }: { tasks: CatalogTask[]; targetBand: number | null }) {
  const [cat, setCat] = useState<CatFilter>("all");
  const [part, setPart] = useState<PartFilter>("all");
  const [diff, setDiff] = useState<DiffFilter>("all");
  const [sort, setSort] = useState<Sort>("default");
  const [q, setQ] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const query = q.trim().toLowerCase();

  // Filter + sort in one memo so a search keystroke doesn't re-scan unless inputs change;
  // paired with the memo()'d card it keeps typing cheap even as the catalog grows.
  const visible = useMemo(() => {
    const out = tasks.filter(
      (t) =>
        (part === "all" || t.taskPart === part) &&
        (cat === "all" || t.category === cat) &&
        (diff === "all" || String(t.difficulty ?? "") === diff) &&
        (!query || t.prompt.toLowerCase().includes(query)),
    );
    if (sort === "difficulty") out.sort((a, b) => (a.difficulty ?? 9) - (b.difficulty ?? 9));
    else if (sort === "band") out.sort((a, b) => (a.bandLow ?? 9) - (b.bandLow ?? 9));
    return out; // "default" keeps the server order (newest first)
  }, [tasks, part, cat, diff, query, sort]);

  const filtersActive = cat !== "all" || part !== "all" || diff !== "all" || q !== "";
  const clearFilters = () => {
    setCat("all");
    setPart("all");
    setDiff("all");
    setQ("");
  };
  const focusSearch = () => (document.getElementById("wl-search-input") as HTMLInputElement | null)?.focus();

  // Power-user accelerator: "/" focuses search from anywhere (skip when already typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (document.getElementById("wl-search-input")) {
        e.preventDefault();
        focusSearch();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="wl-wrap" style={S.wrap}>
      <style>{CSS}</style>

      {/* Header */}
      <header className="wl-header" style={S.header}>
        <div style={{ minWidth: 0 }}>
          <div style={S.overline}>
            <span style={S.overlineDot} />
            Writing Lab
          </div>
          <h1 className="wl-h1" style={S.h1}>
            Pick a prompt<span style={{ color: "var(--brand)" }}>.</span>
          </h1>
          <p style={S.sub}>
            Pick a Task 1 or Task 2 prompt and get an estimated band range with a concrete plan to lift it — not a verdict.
          </p>
        </div>
        {targetBand != null && (
          <div style={S.target}>
            <span style={S.targetDot} />
            <span style={S.targetLab}>Target</span>
            <span style={S.targetVal}>{targetBand.toFixed(1)}</span>
            <span style={S.targetHint}>band</span>
          </div>
        )}
      </header>

      {/* Controls — facet filters on top, search + sort + count below. Splitting the rows
          keeps the three segmented groups grouped and lets sort + count sit with search. */}
      <div className="wl-controls">
        <div className="wl-segrow">
          <Segmented name="Task" segments={PART_SEGMENTS} value={part} onChange={(v) => setPart(v as PartFilter)} label="Filter by task" />
          <Segmented name="Type" segments={SEGMENTS} value={cat} onChange={(v) => setCat(v as CatFilter)} label="Filter by category" />
          <Segmented name="Level" segments={DIFF_SEGMENTS} value={diff} onChange={(v) => setDiff(v as DiffFilter)} label="Filter by difficulty" />
        </div>
        <div className="wl-searchrow">
          <Input
            id="wl-search-input"
            icon="search"
            placeholder="Search prompts"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && q) {
                e.preventDefault();
                setQ("");
              }
            }}
            wrapStyle={{ flex: 1, minWidth: 200 }}
            aria-label="Search prompts"
            trailing={
              q ? (
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    focusSearch(); // keep focus in the field so keyboard users aren't dropped to <body>
                  }}
                  aria-label="Clear search"
                  className="wl-clear"
                  style={S.clear}
                >
                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6 6 18 M6 6l12 12" />
                  </svg>
                </button>
              ) : searchFocused ? null : (
                <kbd className="wl-kbd" style={S.kbd} aria-hidden="true">/</kbd>
              )
            }
          />
          <span style={S.sortWrap}>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              aria-label="Sort prompts"
              className="wl-sort"
              style={S.sort}
            >
              <option value="default">Recommended</option>
              <option value="difficulty">By difficulty</option>
              <option value="band">By band</option>
            </select>
            <svg style={S.sortChevron} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
          <span className="wl-count" style={S.count}>
            {visible.length} prompts · timed practice
          </span>
        </div>
      </div>

      {/* Help — progressive disclosure, collapsed by default. Decodes the page's
          vocabulary for first-timers without taxing returning users (tap-friendly). */}
      <details className="wl-help" style={S.help}>
        <summary style={S.helpSummary}>
          <span style={S.helpQ} aria-hidden="true">?</span>
          What do these labels mean?
        </summary>
        <div style={S.helpBody}>
          <p style={S.helpLine}>
            <b style={S.helpKey}>Difficulty</b> runs Foundation → Core → Stretch (easiest to hardest).
          </p>
          <p style={S.helpLine}>
            <b style={S.helpKey}>Band range</b> is the level the prompt is pitched at — your target band sits inside it when you see “on target”.
          </p>
          <p style={S.helpLine}>
            <b style={S.helpKey}>Timed practice</b> means every attempt is timed: ~20 min for Task 1, ~40 min for Task 2.
          </p>
        </div>
      </details>

      {/* Grid */}
      {visible.length === 0 ? (
        <div style={S.empty}>
          {tasks.length === 0 ? (
            "No prompts yet — check back soon."
          ) : (
            <>
              <span>No prompts match this filter.</span>
              <button type="button" onClick={clearFilters} className="wl-clearall" style={S.clearAll}>
                Clear filters
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className="wl-grid">
          {visible.map((t) => (
            <li key={t.id} style={S.gridItem}>
              <PromptCard t={t} targetBand={targetBand} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Pill segmented control (wl-seg) — shared by the task-part, category, and difficulty
 *  filters. `name` is the visible group label (sits above the pills so it never adds
 *  width on narrow screens); `label` is the screen-reader group name. */
function Segmented({
  segments,
  value,
  onChange,
  label,
  name,
}: {
  segments: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  label: string;
  name: string;
}) {
  return (
    <div style={S.segGroup}>
      <span style={S.segName}>{name}</span>
      <div style={S.segment} role="group" aria-label={label}>
        {segments.map((seg) => {
          const active = value === seg.value;
          return (
            <button
              key={seg.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(seg.value)}
              className="wl-seg"
              style={{ ...S.seg, ...(active ? S.segActive : null) }}
            >
              {seg.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// memo: with a stable `t` ref (from the server-sent array) and stable targetBand, a
// search keystroke that only changes which cards are listed won't re-render the rest.
const PromptCard = memo(function PromptCard({ t, targetBand }: { t: CatalogTask; targetBand: number | null }) {
  const isTask1 = t.taskPart === "task1";
  const topic = t.topic;
  const stripColor = topic ? `var(--topic-${topic}-color)` : "var(--border-strong)";
  const accentBg = topic ? `var(--topic-${topic}-tint)` : "var(--surface-inset)";
  const accentInk = topic ? `var(--topic-${topic}-ink)` : "var(--text-muted)";
  const hoverBorder = topic ? `var(--topic-${topic}-tint-border)` : "var(--border-strong)";
  const hasBand = t.bandLow != null && t.bandHigh != null;
  // "On target" when the user's target band sits inside this prompt's range — ties the
  // header Target pill to the cards (the core "name your level" principle, not decoration).
  const onTarget = targetBand != null && hasBand && targetBand >= t.bandLow! && targetBand <= t.bandHigh!;
  // Task 1 ~20 min; Task 2 ~40 min.
  const minutes = isTask1 ? 20 : MINUTES;
  const meta =
    (hasBand ? `band ${t.bandLow!.toFixed(1)}${EN_DASH}${t.bandHigh!.toFixed(1)} · ` : "") + `${minutes} min`;

  const cardStyle = {
    ...S.card,
    "--t-color": stripColor,
    "--t-border": hoverBorder,
  } as CSSProperties;

  return (
    <Link href={`/app/writing/attempt/${t.id}`} className="wl-card" style={cardStyle}>
      <span style={{ ...S.strip, background: stripColor }} />
      {isTask1 && t.imageUrl && (
        // Decorative preview — the chart's data is presented on the attempt page, and the
        // prompt heading already names the task, so empty alt avoids a meaningless announce.
        <img src={t.imageUrl} alt="" loading="lazy" decoding="async" style={S.thumb} />
      )}
      <div style={S.body}>
        <div style={S.metaRow}>
          {topic && (
            <span style={{ ...S.chip, background: accentBg, color: accentInk }}>
              <TopicGlyph d={TOPIC_ICON[topic]} />
              {writingTopicLabel[topic]}
            </span>
          )}
          {t.difficulty && (
            <div
              style={S.meter}
              role="img"
              aria-label={`Difficulty: ${writingDifficultyLabel[t.difficulty]} (${t.difficulty} of 3)`}
              title={`Difficulty: ${writingDifficultyLabel[t.difficulty]}`}
            >
              <span style={S.meterLabel}>{writingDifficultyLabel[t.difficulty]}</span>
              <span style={S.meterTrack} aria-hidden="true">
                {[1, 2, 3].map((seg) => (
                  <span
                    key={seg}
                    style={{
                      ...S.meterSeg,
                      background: seg <= t.difficulty! ? accentInk : "var(--surface-inset)",
                    }}
                  />
                ))}
              </span>
            </div>
          )}
        </div>

        {/* Not a heading: in a semantic <ul> of card-links the link text is the
            accessible name and the list carries navigation; a heading per long-sentence
            prompt only bloated screen-reader heading nav without aiding it. */}
        <p style={S.question}>{t.prompt}</p>

        <div style={S.footer}>
          <div style={S.footerLeft}>
            {t.taskType ? (
              <span style={S.typeTag}>{writingTaskTypeLabel[t.taskType]}</span>
            ) : isTask1 ? (
              <span style={S.typeTag}>Task 1 · Chart</span>
            ) : null}
            <span style={S.metaLine}>
              {meta}
              {onTarget && <span style={S.onTarget}> · on target</span>}
            </span>
          </div>
          <span className="wl-arrow" style={{ ...S.arrow, background: accentBg, color: accentInk }} aria-hidden="true">
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </span>
        </div>
      </div>
    </Link>
  );
});

function TopicGlyph({ d }: { d: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ display: "block", flex: "none" }}>
      <path d={d} />
    </svg>
  );
}

const CSS = `
.wl-wrap{padding:24px 16px 56px}
.wl-h1{font-size:30px}
.wl-header{flex-direction:column;align-items:flex-start}
.wl-controls{display:flex;flex-direction:column;gap:12px}
.wl-segrow{display:flex;flex-wrap:wrap;gap:10px}
.wl-searchrow{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.wl-grid{display:grid;grid-template-columns:1fr;gap:16px;list-style:none;margin:0;padding:0}
.wl-count{flex:none}
/* Seg sizing lives in the class (not inline) so the breakpoint wins: tight padding +
   12px font on touch keeps the 4-up Level group ('Foundation') comfortably inside a
   320px viewport (~264px natural width vs 288px content box — ~24px headroom). */
.wl-seg{min-height:44px;padding:0 9px;font-size:12px}
.wl-seg:hover{color:var(--text-primary)!important}
.wl-clear{color:var(--text-muted)}
.wl-clear:hover{color:var(--text-primary)}
/* The "/" hint only means something with a physical keyboard — hide it on touch. */
@media (hover:none){.wl-kbd{display:none}}
.wl-sort:hover{border-color:var(--border-strong)}
.wl-sort:focus-visible{border-color:var(--brand)}
.wl-clearall:hover{background:var(--surface-hover);border-color:var(--brand-border);color:var(--brand)}
.wl-help summary{cursor:pointer}
.wl-help summary::-webkit-details-marker{display:none}
.wl-help summary::marker{content:""}
.wl-help summary:hover{color:var(--text-secondary)}
.wl-card{transition:transform .18s cubic-bezier(.2,.7,.3,1),box-shadow .18s ease,border-color .18s ease}
.wl-card:hover{transform:translateY(-4px);box-shadow:0 18px 36px -20px var(--t-color);border-color:var(--t-border)}
.wl-arrow{transition:transform .18s ease}
.wl-card:hover .wl-arrow{transform:translateX(2px)}
@media (min-width:680px){
  .wl-grid{grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
  .wl-header{flex-direction:row;align-items:flex-end;justify-content:space-between}
}
@media (min-width:768px){
  .wl-wrap{padding:32px 28px 72px}
  .wl-h1{font-size:42px}
  /* Desktop: roomier segments at the 13px field-matching size; the 44px touch
     target and tighter mobile padding only matter on small screens. */
  .wl-seg{min-height:38px;padding:0 16px;font-size:13px}
}
@media (prefers-reduced-motion:reduce){
  .wl-card,.wl-arrow{transition:none}
  .wl-card:hover{transform:none}
  .wl-card:hover .wl-arrow{transform:none}
}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },

  header: { display: "flex", gap: 18, flexWrap: "wrap" },
  overline: { display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", color: "var(--text-link)", textTransform: "uppercase", marginBottom: 12 },
  overlineDot: { width: 7, height: 7, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  h1: { margin: 0, lineHeight: 1.0, fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-primary)", textWrap: "balance" },
  sub: { margin: "12px 0 0", fontSize: 15, lineHeight: 1.55, color: "var(--text-secondary)", maxWidth: "44ch" },

  target: { display: "inline-flex", alignItems: "center", gap: 8, flex: "none", padding: "12px 18px", borderRadius: 13, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-xs)" },
  targetDot: { width: 8, height: 8, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  targetLab: { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" },
  targetVal: { fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 20, color: "var(--text-primary)" },
  targetHint: { fontSize: 12, color: "var(--text-muted)" },

  segGroup: { display: "flex", flexDirection: "column", gap: 6, flex: "none" },
  segName: { paddingLeft: 2, fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, letterSpacing: "0.01em", color: "var(--text-muted)" },
  segment: { display: "inline-flex", padding: 4, gap: 4, background: "var(--surface-inset)", borderRadius: 11, flex: "none" },
  seg: { appearance: "none", border: "none", background: "transparent", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, cursor: "pointer", transition: "var(--transition-colors)" },
  segActive: { background: "var(--surface)", color: "var(--text-primary)", boxShadow: "var(--shadow-xs)" },
  // Numeric meta → stays mono (sanctioned for numerals); bumped to 12 for legibility.
  count: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", flex: "none" },
  // Search clear-X — generous 40px hit area (WCAG 2.5.8) around a 15px glyph, neutral until hover.
  clear: { appearance: "none", border: "none", background: "transparent", width: 40, height: 40, padding: 0, display: "grid", placeItems: "center", cursor: "pointer", flex: "none", borderRadius: "var(--radius-full)" },
  // "/" hint — non-interactive cue that the key focuses search.
  kbd: { fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 7px", background: "var(--surface-inset)", flex: "none" },

  // Sort — native select (ordering ≠ filtering, so a distinct standard control is right).
  sortWrap: { position: "relative", display: "inline-flex", alignItems: "center", flex: "none" },
  sort: { appearance: "none", WebkitAppearance: "none", MozAppearance: "none", height: 42, padding: "0 34px 0 13px", border: "2px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-raised)", color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "var(--transition-colors)" },
  sortChevron: { position: "absolute", right: 12, pointerEvents: "none", color: "var(--text-muted)" },

  // Help disclosure — quiet, sits between the controls and the grid.
  help: { marginTop: -8 },
  helpSummary: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--text-muted)", userSelect: "none" },
  helpQ: { display: "grid", placeItems: "center", width: 18, height: 18, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, flex: "none" },
  helpBody: { display: "flex", flexDirection: "column", gap: 6, marginTop: 12, padding: "14px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", maxWidth: "62ch" },
  helpLine: { margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--text-secondary)" },
  helpKey: { color: "var(--text-primary)", fontWeight: 600 },

  empty: { display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "32px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" },
  clearAll: { appearance: "none", cursor: "pointer", padding: "9px 16px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, transition: "var(--transition-colors)" },

  gridItem: { listStyle: "none", display: "flex" },
  card: { width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", boxShadow: "var(--shadow-xs)", textDecoration: "none", color: "inherit", cursor: "pointer" },
  strip: { display: "block", height: 5, width: "100%", flex: "none" },
  // Task 1 chart thumbnail — contain + white bg so the whole chart shows, uncropped.
  thumb: { width: "100%", height: 132, objectFit: "contain", background: "var(--surface)", borderBottom: "1px solid var(--border-subtle)", flex: "none" },
  body: { padding: "20px 20px 16px", flex: 1, display: "flex", flexDirection: "column" },

  metaRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 15 },
  // Topic label → font-ui, sentence-case, ≥12px (was mono-caps 11). Color stays.
  chip: { display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, padding: "5px 10px", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, letterSpacing: "-0.005em" },

  meter: { display: "inline-flex", alignItems: "center", gap: 8, flex: "none" },
  // Difficulty label → font-ui, sentence-case (was mono-caps 10.5).
  meterLabel: { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 500, color: "var(--text-muted)" },
  meterTrack: { display: "inline-flex", gap: 4 },
  meterSeg: { width: 14, height: 4, borderRadius: 99 },

  question: { margin: "0 0 16px", fontSize: 17, fontWeight: 500, lineHeight: 1.42, letterSpacing: "-0.005em", color: "var(--text-primary)", flex: 1 },

  footer: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--border-subtle)", paddingTop: 15 },
  footerLeft: { display: "flex", flexDirection: "column", gap: 5, minWidth: 0 },
  // Type tag → font-ui, sentence-case, 12px (was mono-caps 10).
  typeTag: { alignSelf: "flex-start", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 7, padding: "3px 9px", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 500 },
  // Numeric meta (band/minutes) → stays mono; bumped to 12.
  metaLine: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" },
  onTarget: { color: "var(--text-link)", fontWeight: 600 },
  arrow: { width: 36, height: 36, flex: "none", borderRadius: "var(--radius-full)", display: "grid", placeItems: "center" },
};
