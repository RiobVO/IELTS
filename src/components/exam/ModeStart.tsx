import Link from "next/link";
import type React from "react";
import { Icon } from "@/components/core/icons";

/**
 * ModeStart — серверный экран выбора режима ДО создания attempt (P0).
 * Режим уезжает в URL (?mode=practice | ?mode=mock[&min=NN]), страница раннера
 * создаёт попытку уже с ним: mode — серверная сущность (рейтинг/дневной кап
 * ветвятся по attempt.mode), клиентского состояния здесь нет вовсе — только
 * ссылки. Общий для обоих раннеров (legacy atomized и iframe) и обеих секций.
 *
 * Честность first-attempt-only (§4.6): если тест уже сдавался — предупреждаем,
 * что mock в рейтинг не пойдёт, ДО старта.
 */
export function ModeStart({
  title,
  meta,
  href,
  mockPresets,
  defaultMinutes,
  alreadyAttempted,
  listening,
}: {
  title: string;
  meta: string;
  /** База маршрута теста, напр. `/app/exam/<id>` или `/app/reading/<id>`. */
  href: string;
  /** Пресеты лимита mock в минутах (legacy Reading); null — длительность задаёт сам раннер/запись. */
  mockPresets?: number[] | null;
  defaultMinutes?: number | null;
  alreadyAttempted: boolean;
  listening?: boolean;
}) {
  const mockHref = (min?: number) =>
    min != null ? `${href}?mode=mock&min=${min}` : `${href}?mode=mock`;

  return (
    <div style={MS.shell}>
      <style>{MODE_START_CSS}</style>
      <div style={MS.panel}>
        <span style={MS.kicker}>Ready to begin</span>
        <h1 style={MS.title}>{title}</h1>
        <p style={MS.meta}>{meta}</p>
        <div className="mode-start-cards" style={MS.cards}>
          <div style={MS.card}>
            <span style={MS.cardIcon}>
              <Icon name="pencil-check" size={22} />
            </span>
            <div style={MS.cardTitle}>Practice</div>
            <p style={MS.cardDesc}>
              {listening
                ? "A learning run — take it calmly and study the review after. Never affects your rating or daily limit."
                : "Untimed — pause, restart, work at your own pace. Never affects your rating or daily limit."}
            </p>
            <Link href={`${href}?mode=practice`} className="mode-start-btn" style={MS.btnSecondary}>
              Start practice
              <Icon name="arrow-right" size={16} />
            </Link>
          </div>
          <div style={MS.card}>
            <span style={{ ...MS.cardIcon, background: "var(--brand-subtle)", color: "var(--brand)" }}>
              <Icon name="clock" size={22} />
            </span>
            <div style={MS.cardTitle}>Mock exam</div>
            <p style={MS.cardDesc}>
              {listening
                ? "Real exam conditions — the recording plays once, no pause or replay."
                : "Timed — auto-submits once your time is up, just like the real test."}
            </p>
            {!listening && (
              <p className="mode-mock-hint">
                <Icon name="info" size={15} strokeWidth={2.2} />
                <span>
                  On a phone this runs in a compact, stacked layout. A tablet or computer gives you
                  the full side-by-side view — closer to the real exam. You can still start below.
                </span>
              </p>
            )}
            {mockPresets && mockPresets.length > 0 && (
              <div className="mode-start-presets" style={MS.presets} aria-label="Time limit in minutes">
                {mockPresets.map((m) => (
                  <Link
                    key={m}
                    href={mockHref(m)}
                    className="mode-start-chip"
                    style={m === defaultMinutes ? { ...MS.chip, ...MS.chipActive } : MS.chip}
                    title={`Start mock with a ${m}-minute limit`}
                  >
                    {m} min
                  </Link>
                ))}
              </div>
            )}
            <Link
              href={mockHref(mockPresets ? (defaultMinutes ?? undefined) : undefined)}
              className="mode-start-btn"
              style={MS.btnPrimary}
            >
              {mockPresets && defaultMinutes != null ? `Start mock · ${defaultMinutes} min` : "Start mock exam"}
              <Icon name="arrow-right" size={16} />
            </Link>
            <p style={MS.ratingNote}>
              {alreadyAttempted
                ? "You've taken this test before — this mock won't change your rating."
                : "Your first take of a test counts toward your rating."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const MODE_START_CSS = `
.mode-start-cards{grid-template-columns:1fr}
@media (min-width:720px){.mode-start-cards{grid-template-columns:1fr 1fr}}
.mode-start-btn{transition:var(--transition-colors),transform 150ms cubic-bezier(0.16,1,0.3,1)}
.mode-start-btn:hover{filter:brightness(1.05)}
.mode-start-btn:active{transform:translateY(1px)}
.mode-start-chip{transition:var(--transition-colors)}
.mode-start-chip:hover{background:var(--surface-hover)}
.mode-start-presets{flex-wrap:wrap}
/* Мягкий совет для mock на узком экране: <1024px раннер теряет двух-панельный вид
   (atomized → табы; iframe → сжатая верстка). Порог парный к min-width:1024px раннера,
   поэтому 1023 (на ровно 1024 совет уже неуместен). Не блокирует старт. display
   переключается ТОЛЬКО здесь (не inline) — иначе media не победит. */
.mode-mock-hint{display:none;gap:9px;align-items:flex-start;margin:2px 0 2px;padding:10px 12px;border-radius:var(--radius-md);background:var(--surface-hover);border:1px solid var(--border);font-family:var(--font-ui);font-size:var(--text-xs);line-height:1.45;color:var(--text-secondary)}
.mode-mock-hint svg{margin-top:1px;color:var(--text-muted)}
@media (max-width:1023px){.mode-mock-hint{display:flex}}
/* Чипы выбора лимита времени — единственный способ выбрать mock-таймер, 34px < 44px на touch. */
@media (pointer:coarse){.mode-start-chip{min-height:44px}}
@media (prefers-reduced-motion:reduce){.mode-start-btn,.mode-start-chip{transition:none}}
`;

const MS: Record<string, React.CSSProperties> = {
  shell: { minHeight: "100dvh", display: "grid", placeItems: "center", padding: 20, background: "var(--bg-base)" },
  panel: { width: "100%", maxWidth: 620, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-lg)", padding: "28px 26px" },
  kicker: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" },
  title: { margin: "8px 0 4px", fontFamily: "var(--font-reading)", fontSize: "var(--text-2xl)", fontWeight: 800, color: "var(--text-primary)", lineHeight: 1.15 },
  meta: { margin: "0 0 20px", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)" },
  cards: { display: "grid", gap: 14 },
  card: { display: "flex", flexDirection: "column", gap: 9, padding: 18, borderRadius: "var(--radius-lg)", border: "1.5px solid var(--border)", background: "var(--surface-raised)" },
  cardIcon: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: "var(--radius-md)", background: "var(--surface-hover)", color: "var(--text-secondary)" },
  cardTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 800, color: "var(--text-primary)" },
  cardDesc: { margin: 0, flex: 1, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5 },
  presets: { display: "flex", gap: 6 },
  chip: { display: "inline-flex", alignItems: "center", height: 34, padding: "0 12px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, textDecoration: "none" },
  chipActive: { border: "1.5px solid var(--brand)", color: "var(--brand)", background: "var(--brand-subtle)" },
  btnPrimary: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, height: 44, padding: "0 18px", borderRadius: "var(--radius-md)", background: "var(--brand)", color: "var(--text-on-brand)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 800, textDecoration: "none", boxShadow: "0 2px 0 0 var(--brand-edge)" },
  btnSecondary: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, height: 44, padding: "0 18px", borderRadius: "var(--radius-md)", background: "var(--surface)", border: "1.5px solid var(--border-strong)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 800, textDecoration: "none" },
  ratingNote: { margin: "2px 0 0", fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", lineHeight: 1.45 },
};
