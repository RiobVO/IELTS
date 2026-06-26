"use client";

import { useState, type CSSProperties } from "react";
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
 * type-tag, band-range, время. Фильтр по категории (All/Academic/General) + поиск по
 * тексту; сервер (`page.tsx`) передаёт уже опубликованные темы. Карточки с неполными
 * метаданными (legacy до бэкфилла) мягко деградируют в нейтральный вид.
 */

type CatFilter = "all" | "academic" | "general";

const SEGMENTS: { value: CatFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "academic", label: "Academic" },
  { value: "general", label: "General" },
];

const MINUTES = 40;
const EN_DASH = "–";

/**
 * Topic palette (handoff §Design Tokens). The ONE sanctioned place for named hex:
 * the six brand-adjacent topic accents + their tints and hover-border tints, plus
 * the inline SVG glyph. Everything else in this file rides bando tokens.
 */
interface TopicVisual {
  color: string;
  tint: string;
  tintBorder: string;
  icon: string;
}
const TOPIC: Record<WritingTopic, TopicVisual> = {
  society: {
    color: "#6D5AE6",
    tint: "#EEEBFC",
    tintBorder: "#D8D1F7",
    icon: "M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 20v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8",
  },
  environment: {
    color: "#1F9D6B",
    tint: "#E4F4ED",
    tintBorder: "#BFE6D5",
    icon: "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z M2 21c0-3 1.9-5.4 5.1-6",
  },
  crime: {
    color: "#E0484D",
    tint: "#FBE9E9",
    tintBorder: "#F4C9CB",
    icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  },
  technology: {
    color: "#2F73E8",
    tint: "#E6EEFB",
    tintBorder: "#C5D8F6",
    icon: "M5 5h14v14H5z M9 9h6v6H9z M9 1v3 M15 1v3 M9 20v3 M15 20v3 M1 9h3 M1 15h3 M20 9h3 M20 15h3",
  },
  food: {
    color: "#DB7A2B",
    tint: "#FAEEDF",
    tintBorder: "#F0D6B4",
    icon: "M4 2v6a2 2 0 0 0 4 0V2 M6 2v20 M18 2c-1.7 0-3 2-3 5v5h3 M18 2v20",
  },
  culture: {
    color: "#0F9C92",
    tint: "#E0F3F1",
    tintBorder: "#B7E3DE",
    icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M2 12h20 M12 2a14 14 0 0 1 0 20 14 14 0 0 1 0-20Z",
  },
};

export function WritingCatalog({ tasks, targetBand }: { tasks: CatalogTask[]; targetBand: number | null }) {
  const [cat, setCat] = useState<CatFilter>("all");
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = tasks.filter(
    (t) => (cat === "all" || t.category === cat) && (!query || t.prompt.toLowerCase().includes(query)),
  );

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
            Write a Task 2 essay and get an estimated band range with a concrete plan to lift it — not a verdict.
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

      {/* Control row */}
      <div className="wl-filterrow" style={S.filterRow}>
        <div style={S.segment} role="group" aria-label="Filter by category">
          {SEGMENTS.map((seg) => {
            const active = cat === seg.value;
            return (
              <button
                key={seg.value}
                type="button"
                aria-pressed={active}
                onClick={() => setCat(seg.value)}
                className="wl-seg"
                style={{ ...S.seg, ...(active ? S.segActive : null) }}
              >
                {seg.label}
              </button>
            );
          })}
        </div>
        <Input
          icon="search"
          placeholder="Search prompts"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          wrapStyle={{ flex: 1, minWidth: 200 }}
          aria-label="Search prompts"
        />
        <span style={S.count}>
          {filtered.length} prompts · ~250 words each
        </span>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div style={S.empty}>
          {tasks.length === 0 ? "No prompts yet — check back soon." : "No prompts match this filter."}
        </div>
      ) : (
        <div className="wl-grid">
          {filtered.map((t) => (
            <PromptCard key={t.id} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function PromptCard({ t }: { t: CatalogTask }) {
  const v = t.topic ? TOPIC[t.topic] : null;
  const stripColor = v ? v.color : "var(--border-strong)";
  const accentBg = v ? v.tint : "var(--surface-inset)";
  const accentInk = v ? v.color : "var(--text-muted)";
  const hoverBorder = v ? v.tintBorder : "var(--border-strong)";
  const hasBand = t.bandLow != null && t.bandHigh != null;
  const meta =
    (hasBand ? `band ${t.bandLow!.toFixed(1)}${EN_DASH}${t.bandHigh!.toFixed(1)} · ` : "") + `${MINUTES} min`;

  const cardStyle = {
    ...S.card,
    "--t-color": stripColor,
    "--t-border": hoverBorder,
  } as CSSProperties;

  return (
    <Link href={`/app/writing/attempt/${t.id}`} className="wl-card" style={cardStyle}>
      <span style={{ ...S.strip, background: stripColor }} />
      <div style={S.body}>
        <div style={S.metaRow}>
          {t.topic && v && (
            <span style={{ ...S.chip, background: v.tint, color: v.color }}>
              <TopicGlyph d={v.icon} />
              {writingTopicLabel[t.topic]}
            </span>
          )}
          {t.difficulty && (
            <div style={S.meter}>
              <span style={S.meterLabel}>{writingDifficultyLabel[t.difficulty]}</span>
              <span style={S.meterTrack}>
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

        <h3 style={S.question}>{t.prompt}</h3>

        <div style={S.footer}>
          <div style={S.footerLeft}>
            {t.taskType && <span style={S.typeTag}>{writingTaskTypeLabel[t.taskType]}</span>}
            <span style={S.metaLine}>{meta}</span>
          </div>
          <span className="wl-arrow" style={{ ...S.arrow, background: accentBg, color: accentInk }}>
            <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </span>
        </div>
      </div>
    </Link>
  );
}

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
.wl-filterrow{display:flex;flex-direction:column;gap:12px;align-items:stretch}
.wl-grid{display:grid;grid-template-columns:1fr;gap:16px}
.wl-seg:hover{color:var(--text-primary)!important}
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
  .wl-filterrow{flex-direction:row;align-items:center}
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
  targetLab: { fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" },
  targetVal: { fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 20, color: "var(--text-primary)" },
  targetHint: { fontSize: 12, color: "var(--text-muted)" },

  filterRow: {},
  segment: { display: "inline-flex", padding: 4, gap: 4, background: "var(--surface-inset)", borderRadius: 11, flex: "none" },
  seg: { appearance: "none", border: "none", background: "transparent", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, minHeight: 38, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 16px", borderRadius: 8, cursor: "pointer", transition: "var(--transition-colors)" },
  segActive: { background: "var(--surface)", color: "var(--text-primary)", boxShadow: "var(--shadow-xs)" },
  count: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", flex: "none" },

  empty: { padding: "32px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" },

  card: { display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", boxShadow: "var(--shadow-xs)", textDecoration: "none", color: "inherit", cursor: "pointer" },
  strip: { display: "block", height: 5, width: "100%", flex: "none" },
  body: { padding: "20px 20px 16px", flex: 1, display: "flex", flexDirection: "column" },

  metaRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 15 },
  chip: { display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, padding: "5px 10px", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" },

  meter: { display: "inline-flex", alignItems: "center", gap: 8, flex: "none" },
  meterLabel: { fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-disabled)" },
  meterTrack: { display: "inline-flex", gap: 4 },
  meterSeg: { width: 14, height: 4, borderRadius: 99 },

  question: { margin: "0 0 16px", fontSize: 17, fontWeight: 500, lineHeight: 1.42, letterSpacing: "-0.005em", color: "var(--text-primary)", flex: 1 },

  footer: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--border-subtle)", paddingTop: 15 },
  footerLeft: { display: "flex", flexDirection: "column", gap: 5, minWidth: 0 },
  typeTag: { alignSelf: "flex-start", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 7, padding: "3px 8px", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" },
  metaLine: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" },
  arrow: { width: 42, height: 42, flex: "none", borderRadius: "var(--radius-full)", display: "grid", placeItems: "center" },
};
