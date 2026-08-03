"use client";

import { type CSSProperties } from "react";
import Link from "next/link";
import { Icon } from "@/components/core/icons";
import { Onboarding } from "@/components/speaking/Onboarding";
import type { SpeakingCatalogTask } from "@/lib/speaking/read";

/**
 * SpeakingCatalog — клиентское тело каталога Speaking Lab (handoff: cue-card grid,
 * out-of-scope reuse → bando/Writing визуальный язык). Карта = одна Part 2 cue-card:
 * промт, «You should say» буллеты, prep/speak-тайминг. Free/premium до использования
 * превью кликают в attempt; после — карта ведёт на upgrade (Ultra-замок). Ultra без
 * замка. Сетка/адаптив — в CSS-классах (инвариант), не inline.
 */
const fmtClock = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m}:${String(r).padStart(2, "0")}`;
};

export function SpeakingCatalog({
  tasks,
  isUltra,
  previewUsed,
}: {
  tasks: SpeakingCatalogTask[];
  isUltra: boolean;
  previewUsed: boolean;
}) {
  // Locked only for a non-Ultra user who has already spent the free preview.
  const locked = !isUltra && previewUsed;

  return (
    <div className="sc-wrap" style={S.wrap}>
      <style>{CSS}</style>

      <Onboarding />

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

      {locked && (
        <div style={S.lockBanner} role="note">
          <Icon name="lock" size={16} strokeWidth={2.3} style={{ color: "var(--text-link)", flex: "none", marginTop: 1 }} />
          <span>
            You&apos;ve used your free Speaking analysis. Upgrade to Ultra for unlimited Part 2 feedback.
          </span>
        </div>
      )}

      {tasks.length === 0 ? (
        <div style={S.empty}>No cue cards yet — check back soon.</div>
      ) : (
        <ul className="sc-grid">
          {tasks.map((t) => (
            <li key={t.id} style={S.gridItem}>
              <CueCard t={t} locked={locked} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CueCard({ t, locked }: { t: SpeakingCatalogTask; locked: boolean }) {
  const href = locked ? "/app/upgrade" : `/app/speaking/attempt/${t.id}`;
  return (
    <Link href={href} className="sc-card" style={S.card}>
      <span style={S.strip} />
      <div style={S.body}>
        <div style={S.metaRow}>
          <span style={S.partChip}>Part 2 · Long turn</span>
          {locked && (
            <span style={S.lockChip} aria-label="Ultra feature">
              <Icon name="lock" size={12} strokeWidth={2.4} /> Ultra
            </span>
          )}
        </div>

        <p style={S.prompt}>{t.prompt}</p>

        {t.bullets.length > 0 && (
          <div style={S.bullets}>
            <div style={S.bulletsLabel}>You should say:</div>
            <ul style={S.bulletList}>
              {t.bullets.map((b, i) => (
                <li key={i} style={S.bulletItem}>
                  <span style={S.bulletDot} aria-hidden="true" />
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
          <span className="sc-arrow" style={S.arrow} aria-hidden="true">
            <Icon name="arrow-right" size={17} strokeWidth={2.2} />
          </span>
        </div>
      </div>
    </Link>
  );
}

const CSS = `
.sc-wrap{padding:24px 16px 56px}
.sc-h1{font-size:30px}
.sc-header{flex-direction:column;align-items:flex-start}
.sc-grid{display:grid;grid-template-columns:1fr;gap:16px;list-style:none;margin:0;padding:0}
.sc-card{transition:transform .18s cubic-bezier(.2,.7,.3,1),box-shadow .18s ease,border-color .18s ease}
.sc-card:hover{transform:translateY(-4px);box-shadow:var(--shadow-solid-lg);border-color:var(--brand-border)}
.sc-arrow{transition:transform .18s ease}
.sc-card:hover .sc-arrow{transform:translateX(2px)}
@media (min-width:680px){
  .sc-grid{grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
  .sc-header{flex-direction:row;align-items:flex-end;justify-content:space-between}
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

  empty: { padding: "32px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" },

  gridItem: { listStyle: "none", display: "flex" },
  card: { width: "100%", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", boxShadow: "var(--shadow-solid)", textDecoration: "none", color: "inherit", cursor: "pointer" },
  strip: { display: "block", height: 5, width: "100%", flex: "none", background: "var(--brand)" },
  body: { padding: "20px 20px 16px", flex: 1, display: "flex", flexDirection: "column" },

  metaRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 },
  partChip: { display: "inline-flex", alignItems: "center", borderRadius: 8, padding: "5px 10px", background: "var(--brand-subtle)", color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600 },
  lockChip: { display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 7, padding: "3px 8px", border: "1px solid var(--border)", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 700 },

  prompt: { margin: "0 0 14px", fontSize: 18, fontWeight: 600, lineHeight: 1.4, letterSpacing: "-0.01em", color: "var(--text-primary)" },

  bullets: { marginBottom: 16 },
  bulletsLabel: { fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 7 },
  bulletList: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 5 },
  bulletItem: { display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13.5, lineHeight: 1.45, color: "var(--text-secondary)" },
  bulletDot: { flex: "none", width: 5, height: 5, borderRadius: "var(--radius-full)", background: "var(--brand)", marginTop: 7 },

  footer: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: "auto", borderTop: "1px solid var(--border-subtle)", paddingTop: 15 },
  timing: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" },
  arrow: { width: 36, height: 36, flex: "none", borderRadius: "var(--radius-full)", display: "grid", placeItems: "center", background: "var(--brand-subtle)", color: "var(--text-link)" },
};
