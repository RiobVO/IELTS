"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/core/icons";
import { Onboarding } from "@/components/speaking/Onboarding";
import {
  SPEAKING_CATEGORIES,
  speakingCategoryLabel,
  type SpeakingCategory,
} from "@/lib/speaking/catalog-meta";
import type { SpeakingCatalogTask } from "@/lib/speaking/read";

/**
 * SpeakingCatalog — клиентское тело каталога Speaking Lab. Каждая карта = одна Part 2
 * cue-card с темой (Person/Place/Object/Experience/Activity/Media), выведенной из промта
 * (`catalog-meta.detectCategory`). Тема несёт цвет strip + чип + глиф — тот же визуальный
 * язык, что у Writing-каталога (палитра `--topic-*`, мягкая карта `--shadow-xs` + цветной
 * hover), чтобы два лаба ощущались одним продуктом. Free/premium до превью кликают в attempt;
 * после — карта ведёт на upgrade и явно помечена замком. Ultra без замка. Категория-фильтр
 * показывается только когда тем ≥2. Сетка/адаптив — в CSS-классах (инвариант), не inline.
 */

/** Тема → презентационная палитра (значения из `--topic-*`, переиспользованы ради цвета,
 *  не ради writing-семантики) + глиф. Лейблы — в `catalog-meta`. */
const CAT_META: Record<SpeakingCategory, { color: string; ink: string; tint: string; tintBorder: string; icon: IconName }> = {
  person: { color: "var(--topic-society-color)", ink: "var(--topic-society-ink)", tint: "var(--topic-society-tint)", tintBorder: "var(--topic-society-tint-border)", icon: "users" },
  place: { color: "var(--topic-culture-color)", ink: "var(--topic-culture-ink)", tint: "var(--topic-culture-tint)", tintBorder: "var(--topic-culture-tint-border)", icon: "map-pin" },
  object: { color: "var(--topic-food-color)", ink: "var(--topic-food-ink)", tint: "var(--topic-food-tint)", tintBorder: "var(--topic-food-tint-border)", icon: "star" },
  event: { color: "var(--topic-crime-color)", ink: "var(--topic-crime-ink)", tint: "var(--topic-crime-tint)", tintBorder: "var(--topic-crime-tint-border)", icon: "flag" },
  activity: { color: "var(--topic-environment-color)", ink: "var(--topic-environment-ink)", tint: "var(--topic-environment-tint)", tintBorder: "var(--topic-environment-tint-border)", icon: "zap" },
  media: { color: "var(--topic-technology-color)", ink: "var(--topic-technology-ink)", tint: "var(--topic-technology-tint)", tintBorder: "var(--topic-technology-tint-border)", icon: "book-open" },
};

const fmtClock = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m}:${String(r).padStart(2, "0")}`;
};

export function SpeakingCatalog({
  tasks,
  isUltra,
  previewUsed,
  lastBand,
}: {
  tasks: SpeakingCatalogTask[];
  isUltra: boolean;
  previewUsed: boolean;
  lastBand: { low: number; high: number } | null;
}) {
  // Locked only for a non-Ultra user who has already spent the free preview.
  const locked = !isUltra && previewUsed;

  const [cat, setCat] = useState<SpeakingCategory | "all">("all");

  // Filter pills earn their place only when the set actually spans ≥2 themes; on a small
  // single-theme catalog they'd be noise. Order follows the canonical category order.
  const present = SPEAKING_CATEGORIES.filter((c) => tasks.some((t) => t.category === c));
  const showFilter = present.length >= 2;
  const visible = cat === "all" ? tasks : tasks.filter((t) => t.category === cat);

  return (
    <div className="sc-wrap" style={S.wrap}>
      <style>{CSS}</style>

      <header className="sc-header" style={S.header}>
        <div style={{ minWidth: 0 }}>
          <div style={S.overline}>
            <span style={S.overlineDot} />
            Speaking Lab
          </div>
          <h1 className="sc-h1" style={S.h1}>
            Pick a cue card<span style={{ color: "var(--brand)" }}>.</span>
          </h1>
          <p style={S.sub}>
            Speak a Part 2 long-turn for 1–2 minutes and get an estimated band with an annotated transcript — not a verdict.
          </p>
        </div>
        <div style={S.tierPill}>
          <Icon name={locked ? "lock" : "sparkles"} size={15} strokeWidth={2.3} style={{ color: "var(--text-link)" }} />
          <span style={S.tierPillText}>
            {isUltra ? "Ultra · unlimited" : locked ? "Ultra feature" : "1 free analysis"}
          </span>
        </div>
      </header>

      <Onboarding />

      {locked && (
        <div style={S.lockBanner} role="note">
          <Icon name="sparkles" size={16} strokeWidth={2.3} style={{ color: "var(--text-link)", flex: "none", marginTop: 1 }} />
          <span>
            {lastBand
              ? `You scored band ${lastBand.low.toFixed(1)}–${lastBand.high.toFixed(1)} on your free Speaking analysis. `
              : "You've used your free Speaking analysis. "}
            Unlock unlimited Part 2 feedback with Ultra.
          </span>
        </div>
      )}

      {tasks.length === 0 ? (
        <div style={S.empty}>No cue cards yet — check back soon.</div>
      ) : (
        <>
          <div className="sc-controls">
            {showFilter && (
              <div style={S.segment} role="group" aria-label="Filter cue cards by theme">
                {(["all", ...present] as const).map((value) => {
                  const active = cat === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setCat(value)}
                      className="sc-seg"
                      style={{ ...S.seg, ...(active ? S.segActive : null) }}
                    >
                      {value === "all" ? "All" : speakingCategoryLabel[value]}
                    </button>
                  );
                })}
              </div>
            )}
            <span className="sc-count" style={S.count}>
              {visible.length} {visible.length === 1 ? "cue card" : "cue cards"} · Part 2 long turn
            </span>
          </div>

          <ul className="sc-grid">
            {visible.map((t) => (
              <li key={t.id} style={S.gridItem}>
                <CueCard t={t} locked={locked} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CueCard({ t, locked }: { t: SpeakingCatalogTask; locked: boolean }) {
  const m = CAT_META[t.category];
  const href = locked ? "/app/upgrade" : `/app/speaking/attempt/${t.id}`;

  // Locked cards must NOT pose as openable cue-cards: neutralise the theme glow, kill the
  // hover-lift (via the class), dim the prompt, and swap the "go" arrow for an explicit
  // upgrade affordance. The Link's aria-label states the intent instead of reading the
  // long prompt as if it were a practice link.
  const cardStyle = {
    ...S.card,
    "--t-color": locked ? "var(--border-strong)" : m.color,
    "--t-border": locked ? "var(--border-strong)" : m.tintBorder,
  } as CSSProperties;

  return (
    <Link
      href={href}
      className={`sc-card${locked ? " sc-card--locked" : ""}`}
      style={cardStyle}
      aria-label={locked ? `Upgrade to Ultra to unlock this cue card: ${t.prompt}` : undefined}
    >
      <span style={{ ...S.strip, background: locked ? "var(--border-strong)" : m.color }} />
      <div style={S.body}>
        <div style={S.metaRow}>
          <span style={{ ...S.cat, background: locked ? "var(--surface-inset)" : m.tint, color: locked ? "var(--text-muted)" : m.ink }}>
            <Icon name={m.icon} size={13} strokeWidth={2.2} />
            {speakingCategoryLabel[t.category]}
          </span>
          {locked && (
            <span style={S.lockChip} aria-hidden="true">
              <Icon name="lock" size={12} strokeWidth={2.4} /> Ultra
            </span>
          )}
        </div>

        <p style={{ ...S.prompt, ...(locked ? S.promptLocked : null) }}>{t.prompt}</p>

        {t.bullets.length > 0 && (
          <div style={S.bullets}>
            <div style={S.bulletsLabel}>You should say:</div>
            <ul style={S.bulletList}>
              {t.bullets.map((b, i) => (
                <li key={i} style={S.bulletItem}>
                  <span style={{ ...S.bulletDot, background: locked ? "var(--text-disabled)" : m.color }} aria-hidden="true" />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={S.footer}>
          <span style={S.timing}>
            {fmtClock(t.prepSeconds)} prep · up to {fmtClock(t.maxSpeakSeconds)}
          </span>
          {locked ? (
            <span style={S.upgrade}>
              <Icon name="lock" size={13} strokeWidth={2.4} /> Upgrade to unlock
            </span>
          ) : (
            <span className="sc-arrow" style={{ ...S.arrow, background: m.tint, color: m.ink }} aria-hidden="true">
              <Icon name="arrow-right" size={17} strokeWidth={2.2} />
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

const CSS = `
.sc-wrap{padding:24px 16px 56px}
.sc-h1{font-size:30px}
.sc-header{flex-direction:column;align-items:flex-start}
.sc-controls{display:flex;flex-direction:column;align-items:flex-start;gap:12px}
.sc-grid{display:grid;grid-template-columns:1fr;gap:16px;list-style:none;margin:0;padding:0}
.sc-seg{min-height:38px;padding:0 13px;font-size:13px}
.sc-seg:hover{color:var(--text-primary)}
.sc-card{transition:transform .18s cubic-bezier(.2,.7,.3,1),box-shadow .18s ease,border-color .18s ease}
.sc-card:hover{transform:translateY(-4px);box-shadow:0 18px 36px -20px var(--t-color);border-color:var(--t-border)}
.sc-card--locked:hover{transform:none;box-shadow:var(--shadow-xs)}
.sc-arrow{transition:transform .18s ease}
.sc-card:hover .sc-arrow{transform:translateX(2px)}
@media (min-width:680px){
  .sc-grid{grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
  .sc-header{flex-direction:row;align-items:flex-end;justify-content:space-between}
  .sc-controls{flex-direction:row;align-items:center;justify-content:space-between}
}
@media (min-width:768px){
  .sc-wrap{padding:32px 28px 72px}
  .sc-h1{font-size:42px}
}
@media (prefers-reduced-motion:reduce){
  .sc-card,.sc-arrow{transition:none}
  .sc-card:hover{transform:none}
  .sc-card:hover .sc-arrow{transform:none}
}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },

  header: { display: "flex", gap: 18, flexWrap: "wrap" },
  overline: { display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", color: "var(--text-link)", textTransform: "uppercase", marginBottom: 12 },
  overlineDot: { width: 7, height: 7, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  h1: { margin: 0, lineHeight: 1.0, fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-primary)", textWrap: "balance" },
  sub: { margin: "12px 0 0", fontSize: 15, lineHeight: 1.55, color: "var(--text-secondary)", maxWidth: "46ch" },

  tierPill: { display: "inline-flex", alignItems: "center", gap: 8, flex: "none", padding: "10px 16px", borderRadius: 13, border: "1px solid var(--brand-border)", background: "var(--brand-subtle)" },
  tierPillText: { fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, color: "var(--text-link)" },

  lockBanner: { display: "flex", gap: 10, alignItems: "flex-start", padding: "14px 16px", background: "var(--brand-subtle)", border: "1px solid var(--brand-border)", borderRadius: "var(--radius-md)", fontSize: 13.5, lineHeight: 1.5, color: "var(--text-secondary)" },

  // Controls — theme filter (when ≥2 themes) + count. Mirrors the Writing catalog's
  // segmented + count vocabulary so the two labs read as one system.
  segment: { display: "inline-flex", flexWrap: "wrap", padding: 4, gap: 4, background: "var(--surface-inset)", borderRadius: 11 },
  seg: { appearance: "none", border: "none", background: "transparent", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, cursor: "pointer", transition: "var(--transition-colors)" },
  segActive: { background: "var(--surface)", color: "var(--text-primary)", boxShadow: "var(--shadow-xs)" },
  count: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", flex: "none" },

  empty: { padding: "32px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" },

  gridItem: { listStyle: "none", display: "flex" },
  card: { width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", boxShadow: "var(--shadow-xs)", textDecoration: "none", color: "inherit", cursor: "pointer" },
  strip: { display: "block", height: 5, width: "100%", flex: "none" },
  body: { padding: "20px 20px 16px", flex: 1, display: "flex", flexDirection: "column" },

  metaRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 },
  cat: { display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, padding: "5px 10px", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, letterSpacing: "-0.005em" },
  lockChip: { display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 7, padding: "3px 8px", border: "1px solid var(--border)", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 700 },

  prompt: { margin: "0 0 14px", fontSize: 18, fontWeight: 600, lineHeight: 1.4, letterSpacing: "-0.01em", color: "var(--text-primary)" },
  promptLocked: { color: "var(--text-muted)" },

  bullets: { marginBottom: 16 },
  bulletsLabel: { fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 7 },
  bulletList: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 5 },
  bulletItem: { display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13.5, lineHeight: 1.45, color: "var(--text-secondary)" },
  bulletDot: { flex: "none", width: 5, height: 5, borderRadius: "var(--radius-full)", marginTop: 7 },

  footer: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: "auto", borderTop: "1px solid var(--border-subtle)", paddingTop: 15 },
  timing: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" },
  arrow: { width: 36, height: 36, flex: "none", borderRadius: "var(--radius-full)", display: "grid", placeItems: "center" },
  upgrade: { display: "inline-flex", alignItems: "center", gap: 6, flex: "none", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, color: "var(--text-link)" },
};
