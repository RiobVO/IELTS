"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { Icon } from "@/components/core/icons";
import { Input } from "@/components/core/Input";
import { writingCategoryLabel } from "@/lib/writing/labels";
import type { CatalogTask } from "@/lib/writing/read";

/**
 * WritingCatalog — клиентское тело каталога Writing Lab (handoff §1). Держит
 * фильтр категории + поиск по тексту промта; сервер (`page.tsx`) передаёт уже
 * опубликованные темы. Осознанно опущены (нет бэкенда/данных): «Continue your
 * draft» карта (нет хранилища черновиков) и «Drill weakest» чип (нет writing
 * weak-type). Тип-чипы R/L неприменимы к эссе.
 */

type CatFilter = "all" | "academic" | "general";

const SEGMENTS: { value: CatFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "academic", label: "Academic" },
  { value: "general", label: "General" },
];

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
      <header>
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
        {targetBand != null && (
          <div style={S.target}>
            <span style={S.targetLab}>Target</span>
            <span style={S.targetVal}>{targetBand.toFixed(1)}</span>
            <span style={S.targetHint}>Your coach aims every fix at this band</span>
          </div>
        )}
      </header>

      {/* Filter row */}
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
          <b style={{ color: "var(--text-primary)" }}>{filtered.length}</b> prompts · ~250 words · 40 min
        </span>
      </div>

      {/* Prompt list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {filtered.length === 0 ? (
          <div style={S.empty}>
            {tasks.length === 0 ? "No prompts yet — check back soon." : "No prompts match this filter."}
          </div>
        ) : (
          filtered.map((t) => <PromptRow key={t.id} t={t} />)
        )}
      </div>
    </div>
  );
}

function PromptRow({ t }: { t: CatalogTask }) {
  return (
    <Link href={`/app/writing/attempt/${t.id}`} style={S.row} className="wl-row">
      <span style={S.rowTile}>
        <Icon name="pen-line" size={22} strokeWidth={2.25} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.rowOver}>Task 2 · {writingCategoryLabel(t.category)}</div>
        <div className="wl-rowprompt" style={S.rowPrompt}>{t.prompt}</div>
      </div>
      <div style={S.rowRight}>
        <span style={S.rowWords}>~250 words</span>
        <span style={S.rowCta}>
          Write <Icon name="arrow-right" size={16} strokeWidth={2.6} />
        </span>
      </div>
    </Link>
  );
}

const CSS = `
.wl-wrap{padding:24px 16px 56px}
.wl-h1{font-size:30px}
.wl-filterrow{display:flex;flex-direction:column;gap:12px;align-items:stretch}
.wl-row:hover{transform:translateY(-2px);border-color:var(--brand-border)!important;box-shadow:var(--shadow-solid-lg)}
.wl-seg:hover{color:var(--text-primary)!important}
.wl-rowprompt{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
@media (min-width:768px){
  .wl-wrap{padding:32px 28px 72px}
  .wl-h1{font-size:42px}
  .wl-filterrow{flex-direction:row;align-items:center}
}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: 26, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },

  overline: { display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", color: "var(--text-link)", textTransform: "uppercase", marginBottom: 12 },
  overlineDot: { width: 7, height: 7, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  h1: { margin: 0, lineHeight: 1.04, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text-primary)", textWrap: "balance" },
  sub: { margin: "12px 0 0", fontSize: 16, lineHeight: 1.5, color: "var(--text-secondary)", maxWidth: "52ch" },

  target: { marginTop: 20, display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-solid)" },
  targetLab: { fontSize: 12, fontWeight: 700, color: "var(--text-muted)" },
  targetVal: { fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 16, color: "var(--text-primary)" },
  targetHint: { fontSize: 13, fontWeight: 600, color: "var(--text-muted)" },

  filterRow: {},
  segment: { display: "inline-flex", padding: 4, gap: 4, background: "var(--surface-inset)", borderRadius: "var(--radius-full)", flex: "none" },
  seg: { appearance: "none", border: "none", background: "transparent", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, minHeight: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 16px", borderRadius: "var(--radius-full)", cursor: "pointer", transition: "var(--transition-colors)" },
  segActive: { background: "var(--surface)", color: "var(--text-primary)", boxShadow: "var(--shadow-solid)" },
  count: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)", flex: "none" },

  empty: { padding: "32px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)" },

  row: { display: "flex", alignItems: "center", gap: 18, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "18px 20px", textDecoration: "none", color: "inherit", cursor: "pointer", transition: "transform var(--duration-base) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)" },
  rowTile: { width: 46, height: 46, flex: "none", borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: "var(--brand-subtle)", color: "var(--text-link)" },
  rowOver: { fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 },
  rowPrompt: { fontSize: "var(--text-base)", fontWeight: 600, lineHeight: 1.4, color: "var(--text-primary)" },
  rowRight: { flex: "none", textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 },
  rowWords: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" },
  rowCta: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700 },
};
