import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getVocabCatalog, type VocabDeckCard } from "@/lib/vocab/queries";
import { Badge } from "@/components/core/Badge";
import { Icon } from "@/components/core/icons";
import { AppShell } from "../_AppShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vocabulary" };

const TIER_LABEL: Record<string, string> = {
  basic: "Basic",
  premium: "Premium",
  ultra: "Ultra",
};

/**
 * Vocabulary (`/app/vocabulary`) — каталог словарных колод (flashcards + SRS).
 * Полностью серверный: грид ссылок без клиентского состояния (hover — чистый CSS),
 * в отличие от Practice, где фильтры требуют client-компонент. Единственный источник
 * данных — owner-path getVocabCatalog (готовый data-слой, не трогаем). Тир-лок ведёт
 * на /app/upgrade тем же паттерном, что и locked-тесты в каталоге Practice.
 */
export default async function VocabularyPage() {
  const user = await requireUser();
  const decks = await getVocabCatalog(user.id);
  const dueTotal = decks.reduce((sum, d) => sum + d.dueCount, 0);

  return (
    <AppShell active="vocabulary">
      <div className="vc-wrap" style={S.wrap}>
        <style>{CSS}</style>

        <section>
          <div className="vc-overline" style={S.overline}>
            <span style={S.overlineDot} />
            Vocabulary
          </div>
          <h1 className="vc-h1" style={S.h1}>Build your word bank.</h1>
          <p style={S.sub}>
            Study IELTS vocabulary with spaced repetition — review what&apos;s due now, and
            we bring back what you forget later.
          </p>
          {decks.length > 0 && (
            <div style={S.dueSummary}>
              <Icon name="clock" size={16} strokeWidth={2.4} style={{ color: "var(--text-link)" }} />
              {dueTotal > 0 ? (
                <span>
                  <b style={S.dueCount}>{dueTotal}</b> {dueTotal === 1 ? "card" : "cards"} due today
                </span>
              ) : (
                <span>You&apos;re all caught up today</span>
              )}
            </div>
          )}
        </section>

        {decks.length === 0 ? (
          <div style={S.empty}>
            <span style={S.emptyIcon}>
              <Icon name="graduation-cap" size={26} strokeWidth={2} />
            </span>
            <span style={S.emptyTitle}>Vocabulary decks are coming soon</span>
            <span>
              We&apos;re building topic decks with spaced repetition — check back soon to start
              growing your word bank.
            </span>
          </div>
        ) : (
          <div className="vc-grid" style={S.grid}>
            {decks.map((d) => (
              <DeckCard key={d.id} deck={d} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function DeckCard({ deck }: { deck: VocabDeckCard }) {
  const pct = deck.totalCards > 0 ? Math.round((deck.learnedCards / deck.totalCards) * 100) : 0;
  const href = deck.locked ? "/app/upgrade" : `/app/vocabulary/${deck.id}`;
  const tierLabel = TIER_LABEL[deck.tierRequired] ?? deck.tierRequired;

  return (
    <Link
      href={href}
      className={`vc-card${deck.locked ? " vc-card--locked" : ""}`}
      style={S.card}
      aria-label={deck.locked ? `Upgrade to ${tierLabel} to unlock ${deck.title}` : undefined}
    >
      <div style={S.cardTop}>
        {deck.level && <Badge tone="neutral">{deck.level}</Badge>}
        {deck.locked ? (
          <span style={S.lockBadge}>
            <Icon name="lock" size={12} strokeWidth={2.4} /> {tierLabel}
          </span>
        ) : deck.dueCount > 0 ? (
          <Badge tone="brand" mono>{deck.dueCount} to review</Badge>
        ) : deck.totalCards > 0 ? (
          <Badge tone="success">All caught up</Badge>
        ) : null}
      </div>

      <div style={S.cardTitle}>{deck.title}</div>
      {deck.description && <p style={S.cardDesc}>{deck.description}</p>}

      {deck.totalCards > 0 ? (
        <div style={S.progressRow}>
          <span style={S.progressTrack}>
            <span style={{ ...S.progressFill, width: `${pct}%` }} />
          </span>
          <span style={S.progressLabel}>{deck.learnedCards} / {deck.totalCards} learned</span>
        </div>
      ) : (
        <div style={S.progressEmpty}>No cards yet</div>
      )}

      <div style={deck.locked ? S.lockFoot : S.startFoot}>
        {deck.locked ? (
          <>
            <Icon name="lock" size={15} /> Unlock
          </>
        ) : (
          <>
            Review <Icon name="arrow-right" size={16} strokeWidth={2.6} />
          </>
        )}
      </div>
    </Link>
  );
}

/* Адаптив: грид 1 колонка mobile → 2 (≥640) → 3 (≥1024), брейкпоинт-свойства только
   в классах (инвариант проекта — inline перебивает media-query). */
const CSS = `
.vc-wrap{padding:24px 16px 56px}
.vc-h1{font-size:30px}
.vc-grid{display:grid;grid-template-columns:1fr;gap:16px}
.vc-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-solid-lg)}
.vc-card--locked:hover{transform:none;box-shadow:var(--shadow-solid);border-color:var(--border)}
@media (min-width:640px){
  .vc-grid{grid-template-columns:repeat(2,1fr)}
}
@media (min-width:768px){
  .vc-wrap{padding:32px 28px 72px}
  .vc-h1{font-size:40px}
}
@media (min-width:1024px){
  .vc-grid{grid-template-columns:repeat(3,1fr)}
}
@media (prefers-reduced-motion:reduce){
  .vc-card{transition:none!important}
}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 1160, margin: "0 auto", display: "flex", flexDirection: "column", gap: 26, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  overline: { display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", color: "var(--brand)", textTransform: "uppercase", marginBottom: 12 },
  overlineDot: { width: 7, height: 7, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  h1: { margin: 0, lineHeight: 1.04, fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-primary)", textWrap: "balance" },
  sub: { margin: "12px 0 0", fontSize: 17, lineHeight: 1.5, color: "var(--text-muted)", maxWidth: "56ch" },
  dueSummary: { display: "inline-flex", alignItems: "center", gap: 8, marginTop: 18, padding: "9px 16px", borderRadius: "var(--radius-full)", border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-solid)", fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" },
  dueCount: { color: "var(--text-primary)", fontFamily: "var(--font-mono)" },

  empty: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "40px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, lineHeight: 1.5, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", maxWidth: "52ch", marginInline: "auto" },
  emptyIcon: { display: "grid", placeItems: "center", width: 52, height: 52, borderRadius: "50%", background: "var(--brand-subtle)", color: "var(--text-link)", marginBottom: 4 },
  emptyTitle: { fontFamily: "var(--font-ui)", fontSize: 17, fontWeight: 700, color: "var(--text-primary)" },

  grid: {},

  card: { display: "flex", flexDirection: "column", gap: 12, textAlign: "left", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 20, textDecoration: "none", color: "inherit", cursor: "pointer", transition: "transform var(--duration-base) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)" },
  cardTop: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  lockBadge: { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: "var(--radius-full)", border: "1px solid var(--border)", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700 },
  cardTitle: { fontSize: 18, fontWeight: 800, letterSpacing: "-0.015em", color: "var(--text-primary)" },
  cardDesc: { margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--text-muted)" },

  progressRow: { display: "flex", flexDirection: "column", gap: 6, marginTop: "auto" },
  progressTrack: { position: "relative", display: "block", height: 7, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden" },
  progressFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  progressLabel: { fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" },
  progressEmpty: { marginTop: "auto", fontSize: 12.5, color: "var(--text-disabled)" },

  startFoot: { marginTop: 4, display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800 },
  lockFoot: { marginTop: 4, display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700 },
};
