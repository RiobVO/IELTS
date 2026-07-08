import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { savedWord } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getVocabCatalog, getVocabOverview, type VocabDeckCard, type VocabOverview } from "@/lib/vocab/queries";
import { getWeakTypeDeckRecommendation, type WeakTypeDeckRecommendation } from "@/lib/vocab/recommend";
import { bandToCefr, LEVEL_ORDER, type CefrLevel } from "@/lib/vocab/level";
import { Badge } from "@/components/core/Badge";
import { Button } from "@/components/core/Button";
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
 * Vocabulary (`/app/vocabulary`) — каталог словарных колод (flashcards + SRS) с
 * дневным планом сверху. Полностью серверный: план-панель и грид — статичная разметка
 * без клиентского состояния (hover — чистый CSS; единственный клиентский островок —
 * core Button у CTA). Данные: getVocabOverview (план/стрик/банк) + getVocabCatalog
 * (деки) + getWeakTypeDeckRecommendation (V10 rail — дек под слабейший тип вопросов)
 * параллельно — все owner-path, читаются в одну волну. Тир-лок ведёт на /app/upgrade
 * тем же паттерном, что locked-тесты в каталоге Practice.
 */
export default async function VocabularyPage() {
  const user = await requireUser();
  const [overview, decks, weakTypeReco, savedAgg] = await Promise.all([
    getVocabOverview(user.id),
    getVocabCatalog(user.id),
    getWeakTypeDeckRecommendation(user.id),
    // P11 — счётчики личного словаря (owner-path; фильтр user_id явно, как в vocab-queries).
    db
      .select({
        total: sql<number>`count(*)::int`,
        due: sql<number>`(count(*) filter (where ${savedWord.dueAt} <= now()))::int`,
      })
      .from(savedWord)
      .where(eq(savedWord.userId, user.id)),
  ]);
  const savedWords = savedAgg[0] ?? { total: 0, due: 0 };
  // Уровень под целевой band (0039) — для бейджа «Recommended» на совпавшей секции.
  const recommendedLevel = bandToCefr(overview.targetBand);

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
        </section>

        <SavedWordsCard total={savedWords.total} due={savedWords.due} />

        {decks.length > 0 && <PlanPanel overview={overview} ctaHref={pickReviewTarget(decks, overview)} />}

        {weakTypeReco && <WeakTypeRail reco={weakTypeReco} />}

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
          <DeckSections decks={decks} recommendedLevel={recommendedLevel} targetBand={overview.targetBand} />
        )}
      </div>
    </AppShell>
  );
}

/**
 * Цель кнопки «Start review»: дек с наибольшим due; если due нет — первый доступный
 * дек с новыми картами (только когда дневной лимит новых не исчерпан); иначе null →
 * панель показывает all-caught-up, CTA скрыт. Locked-деки исключены.
 */
function pickReviewTarget(decks: VocabDeckCard[], overview: VocabOverview): string | null {
  const open = decks.filter((d) => !d.locked);
  const byDue = open.filter((d) => d.dueCount > 0).sort((a, b) => b.dueCount - a.dueCount);
  if (byDue.length > 0) return `/app/vocabulary/${byDue[0].id}`;
  if (overview.newRemainingToday !== 0) {
    const withNew = open.find((d) => d.totalCards - d.learnedCards > 0);
    if (withNew) return `/app/vocabulary/${withNew.id}`;
  }
  return null;
}

/* ------------------------------- My words -------------------------------- */

/** P11 — вход в личный словарь (saved words из пассажей). Слим-карта-ссылка со
 *  счётчиками; при пустом словаре — подсказка, как добавлять слова. */
function SavedWordsCard({ total, due }: { total: number; due: number }) {
  return (
    <Link href="/app/vocabulary/my-words" className="vc-mywords" style={S.myWords}>
      <span style={S.myWordsIcon}>
        <Icon name="star" size={20} strokeWidth={2.2} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.myWordsTitle}>My words</div>
        <div style={S.myWordsSub}>
          {total === 0
            ? "Save words from reading passages to review them here"
            : `${total} saved${due > 0 ? ` · ${due} due` : ""}`}
        </div>
      </div>
      <Icon name="arrow-right" size={18} strokeWidth={2.4} style={{ color: "var(--text-muted)" }} />
    </Link>
  );
}

/* ------------------------------- Plan panel ------------------------------- */

/** Дневной план (V1) + стрик/цель (V3) + банк слов (V4). Read-only, ничего не пишет. */
function PlanPanel({ overview, ctaHref }: { overview: VocabOverview; ctaHref: string | null }) {
  const { dueToday, forecast7, newRemainingToday, rescueCount, bank, sessionMinutes, streak, reviewedToday, goal } = overview;

  return (
    <section style={S.plan} aria-label="Your vocabulary plan for today">
      <div style={S.planMain}>
        <div style={S.planStats}>
          <Stat value={dueToday} label="Due today" />
          <Stat
            value={
              newRemainingToday === null ? (
                // Visible word, not an "∞" glyph: the primary persona studies on touch,
                // where a title tooltip never fires and a bare symbol reads as noise.
                <span style={S.statText}>Unlimited</span>
              ) : (
                newRemainingToday
              )
            }
            label="New left today"
          />
          <Stat
            value={<>~{sessionMinutes}<small style={S.statSmall}> min</small></>}
            label="Session"
          />
          {/* Two distinct metrics on two timescales — a persistent day-streak and
              today's review goal — kept as separate stat cells, not fused in one. */}
          <div style={S.stat}>
            <span style={{ ...S.statNum, ...S.streakNum }}>
              {streak}
              <Icon name="flame" size={20} strokeWidth={2.2} style={{ color: "var(--streak)" }} />
            </span>
            <span style={S.statLabel}>Day streak</span>
          </div>
          <Stat value={`${reviewedToday}/${goal}`} label="Reviewed today" />
        </div>
        {/* flex-строка CTA: rescue-очередь трудных слов + Start review. */}
        <div style={S.planCta}>
          {rescueCount > 0 && (
            <Link href="/app/vocabulary/rescue" className="vc-rescue" style={S.rescueCta}>
              <Icon name="shield-check" size={14} strokeWidth={2.4} />
              Rescue hard words · {rescueCount}
            </Link>
          )}
          {ctaHref ? (
            <Button href={ctaHref} variant="primary" size="md" trailingIcon="arrow-right">
              Start review
            </Button>
          ) : (
            <span style={S.caughtUp}>
              <Icon name="circle-check" size={18} style={{ color: "var(--success-text)" }} />
              All caught up
            </span>
          )}
        </div>
      </div>

      {/* Secondary status band. Native <details>: collapsed by default on phones
          (a tap-summary keeps the catalog above the fold), force-expanded ≥480px via a
          CSS override of the UA closed-details rule — no JS, no hydration flash. */}
      <details className="vc-foot">
        <summary className="vc-foot-sum">
          <span>Forecast &amp; word bank</span>
          <span className="vc-foot-caret" aria-hidden="true" />
        </summary>
        <div className="vc-foot-body">
          <Spark forecast={forecast7} />
          <div style={S.bank}>
            <BankDot color="var(--success)" label={`${bank.mastered} mastered`} title="Locked in — long review intervals" />
            <BankDot color="var(--brand)" label={`${bank.learning} learning`} title="Seen before, still in active rotation" />
            <BankDot color="var(--text-disabled)" label={`${bank.newCount} new`} title="Not started yet" />
            <span style={S.bankTotal}>{bank.total} words total</span>
          </div>
        </div>
      </details>
    </section>
  );
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div style={S.stat}>
      <span style={S.statNum}>{value}</span>
      <span style={S.statLabel}>{label}</span>
    </div>
  );
}

/** UTC-аббревиатуры дней недели для тиков спарка (offset 0 = сегодня → «TD»). */
const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * 7-дневный прогноз due (столбики, сегодня выделен). Высоты нормированы к максимуму;
 * нулевой день — тонкая метка. Смысловое содержание прогноза — в aria-label (role=img),
 * сами столбики декоративны.
 */
function Spark({ forecast }: { forecast: number[] }) {
  const max = Math.max(...forecast, 1);
  const todayDow = new Date().getUTCDay();
  const label =
    "Due-card forecast for the next 7 days: " +
    forecast
      .map((c, i) => {
        const day = i === 0 ? "today" : i === 1 ? "tomorrow" : DOW[(todayDow + i) % 7];
        return `${day} ${c}`;
      })
      .join(", ");

  // Heaviest upcoming day (excl. today's backlog) — turns the forecast from garnish
  // into a plan signal ("brace for Thursday"). Hidden when nothing is due ahead.
  let peakIdx = 0;
  let peakCount = 0;
  for (let i = 1; i < forecast.length; i++) {
    if (forecast[i] > peakCount) {
      peakCount = forecast[i];
      peakIdx = i;
    }
  }
  const peakLabel =
    peakCount === 0 ? null : `${peakIdx === 1 ? "Tomorrow" : DOW[(todayDow + peakIdx) % 7]} · ${peakCount}`;

  return (
    <div style={S.sparkWrap}>
      <div style={S.spark} role="img" aria-label={label}>
        {forecast.map((c, i) => {
          const isToday = i === 0;
          const h = c === 0 ? 3 : Math.round((c / max) * 34) + 4;
          return (
            <span key={i} style={S.sparkCol}>
              <i style={{ ...S.sparkBar, height: h, background: isToday ? "var(--brand)" : "var(--brand-subtle)" }} />
              <em style={{ ...S.sparkTick, color: isToday ? "var(--text-link)" : "var(--text-muted)" }}>
                {isToday ? "TD" : DOW[(todayDow + i) % 7]}
              </em>
            </span>
          );
        })}
      </div>
      {peakLabel && <span style={S.sparkCaption}>Heaviest ahead: {peakLabel}</span>}
    </div>
  );
}

function BankDot({ color, label, title }: { color: string; label: string; title?: string }) {
  return (
    <span style={S.bankItem} title={title}>
      <i style={{ ...S.bankDotI, background: color }} />
      {label}
    </span>
  );
}

/* ------------------------------ Weak-type rail ----------------------------- */

/**
 * V10: рекомендация дека под слабейший тип вопросов (per_type_breakdown submitted-
 * попыток, порог достоверности — recommend.ts). Рендерится только когда рекомендация
 * не null (нет статистики, порог не пройден или контент ещё не протегирован —
 * рекомендация отсутствует, rail молча скрыт).
 */
function WeakTypeRail({ reco }: { reco: WeakTypeDeckRecommendation }) {
  return (
    <div style={S.rail}>
      <span style={S.railIcon}>
        <Icon name="target" size={19} strokeWidth={2.2} />
      </span>
      <p style={S.railText}>
        Your weakest question type is <b style={S.railStrong}>{reco.qtypeLabel}</b> — this deck
        trains the paraphrase words it relies on.
      </p>
      <Button href={`/app/vocabulary/${reco.deckId}`} variant="secondary" size="sm" trailingIcon="arrow-right">
        {reco.deckTitle}
      </Button>
    </div>
  );
}

/* ------------------------------ Deck sections ----------------------------- */

/** Короткие EN-подписи уровневых секций каталога (0039). */
const SECTION_LABELS: Record<CefrLevel, string> = {
  B1: "B1 — Foundation",
  B2: "B2 — Independent",
  C1: "C1 — Advanced",
};

/**
 * Грид деков, сгруппированный по CEFR-уровню (levelBand) в порядке LEVEL_ORDER.
 * Деки без валидного уровня (null или значение вне канона) уходят в секцию
 * «More decks» последней; пустые секции не рендерятся. Секция, чей уровень совпал
 * с рекомендованным под целевой band пользователя, несёт бейдж «Recommended».
 * Заголовки — обычный поток; грид переиспользует класс vc-grid per-секция (адаптив
 * в CSS-классе, не inline — инвариант проекта).
 */
function DeckSections({
  decks,
  recommendedLevel,
  targetBand,
}: {
  decks: VocabDeckCard[];
  recommendedLevel: CefrLevel | null;
  targetBand: number | null;
}) {
  const sections = LEVEL_ORDER.map((lvl) => ({
    lvl,
    items: decks.filter((d) => d.levelBand === lvl),
  })).filter((s) => s.items.length > 0);
  // Всё, что не попало в канон-уровни (null или неизвестное значение) → «More decks».
  const more = decks.filter((d) => !(LEVEL_ORDER as readonly string[]).includes(d.levelBand ?? ""));

  return (
    <div style={S.sections}>
      {sections.map((s) => (
        <section key={s.lvl} style={S.section}>
          <div style={S.sectionHead}>
            <h2 style={S.sectionTitle}>{SECTION_LABELS[s.lvl]}</h2>
            {s.lvl === recommendedLevel && targetBand != null && (
              <span style={S.recoChip}>
                <Icon name="target" size={13} strokeWidth={2.4} />
                Recommended for your Band {targetBand.toFixed(1)} goal
              </span>
            )}
          </div>
          <div className="vc-grid" style={S.grid}>
            {s.items.map((d) => (
              <DeckCard key={d.id} deck={d} />
            ))}
          </div>
        </section>
      ))}
      {more.length > 0 && (
        <section style={S.section}>
          <div style={S.sectionHead}>
            <h2 style={S.sectionTitle}>More decks</h2>
          </div>
          <div className="vc-grid" style={S.grid}>
            {more.map((d) => (
              <DeckCard key={d.id} deck={d} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* -------------------------------- Deck card ------------------------------- */

function DeckCard({ deck }: { deck: VocabDeckCard }) {
  // Дек «освоен», когда все карты перешли порог interval_days (mastered === total).
  const isMastered = deck.totalCards > 0 && deck.masteredCards >= deck.totalCards;
  const startedPct = deck.totalCards > 0 ? Math.round((deck.learnedCards / deck.totalCards) * 100) : 0;
  const primaryHref = deck.locked ? "/app/upgrade" : `/app/vocabulary/${deck.id}`;
  const tierLabel = TIER_LABEL[deck.tierRequired] ?? deck.tierRequired;

  return (
    // Не-ссылочный контейнер: две явные ссылки в футере (Review/Maintain/Unlock +
    // Browse) вместо одного Link на всю карточку — вложенный Link в Link невалиден.
    <div className={`vc-card${deck.locked ? " vc-card--locked" : ""}`} style={S.card}>
      <div style={S.cardTop}>
        {deck.level && <Badge tone="neutral">{deck.level}</Badge>}
        {deck.locked ? (
          <span style={S.lockBadge}>
            <Icon name="lock" size={12} strokeWidth={2.4} /> {tierLabel}
          </span>
        ) : isMastered ? (
          <Badge tone="success">
            <Icon name="check" size={12} strokeWidth={2.8} /> Mastered
          </Badge>
        ) : deck.dueCount > 0 ? (
          <Badge tone="brand" mono>{deck.dueCount} to review</Badge>
        ) : deck.totalCards > 0 ? (
          <Badge tone="success">All caught up</Badge>
        ) : null}
      </div>

      <div style={S.cardTitle}>{deck.title}</div>
      {deck.description && <p style={S.cardDesc}>{deck.description}</p>}

      {deck.locked ? (
        // Locked decks cluster at the end of the catalog — end the scroll on aspiration
        // (what's inside), not an empty 0% bar. Tier gate stays; this only reframes it.
        <div style={S.lockTeaser}>
          {deck.totalCards > 0 ? `${deck.totalCards} words` : "New deck"} · {tierLabel} plan
        </div>
      ) : deck.totalCards > 0 ? (
        <div style={S.progressRow}>
          <span style={S.progressTrack}>
            <span
              style={{
                ...S.progressFill,
                width: `${isMastered ? 100 : startedPct}%`,
                ...(isMastered ? { background: "var(--success)" } : null),
              }}
            />
          </span>
          <span style={S.progressLabel}>
            {isMastered
              ? `${deck.masteredCards} / ${deck.totalCards} mastered`
              : `${deck.learnedCards} / ${deck.totalCards} started`}
          </span>
        </div>
      ) : (
        <div style={S.progressEmpty}>No cards yet</div>
      )}

      <div style={S.cardFoot}>
        <Link
          href={primaryHref}
          className="vc-flink"
          style={deck.locked ? S.lockFoot : isMastered ? S.maintainFoot : S.startFoot}
          aria-label={deck.locked ? `Upgrade to ${tierLabel} to unlock ${deck.title}` : undefined}
        >
          {deck.locked ? (
            <>
              <Icon name="lock" size={15} /> Unlock
            </>
          ) : isMastered ? (
            <>
              Maintain <Icon name="arrow-right" size={16} strokeWidth={2.6} />
            </>
          ) : (
            <>
              Review <Icon name="arrow-right" size={16} strokeWidth={2.6} />
            </>
          )}
        </Link>
        {!deck.locked && (
          <Link
            href={`/app/vocabulary/${deck.id}/browse`}
            className="vc-flink"
            style={S.browseFoot}
            aria-label={`Browse all words in ${deck.title}`}
          >
            <Icon name="eye" size={14} strokeWidth={2.2} /> Browse
          </Link>
        )}
      </div>
    </div>
  );
}

/* Адаптив: грид 1 колонка mobile → 2 (≥640) → 3 (≥1024), брейкпоинт-свойства только
   в классах (инвариант проекта — inline перебивает media-query). План-панель
   складывается без брейкпоинтов — на flex-wrap. */
const CSS = `
.vc-wrap{padding:24px 16px 56px}
.vc-h1{font-size:30px}
.vc-grid{display:grid;grid-template-columns:1fr;gap:16px}
.vc-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-solid-lg)}
.vc-card--locked:hover{transform:none;box-shadow:var(--shadow-solid);border-color:var(--border)}
.vc-rescue:hover{border-color:currentColor;background:var(--surface)}
.vc-mywords:hover{border-color:var(--brand-border);box-shadow:var(--shadow-solid-lg);transform:translateY(-1px)}
/* Footer links are the densest tap cluster — give them a real 44px target and the
   app's signature focus ring (inline styles can't carry :focus-visible). */
.vc-flink{min-height:44px}
.vc-flink:focus-visible,.vc-mywords:focus-visible,.vc-rescue:focus-visible{outline:none;box-shadow:var(--ring)}
@media (prefers-reduced-motion:reduce){.vc-mywords{transition:none!important}}
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
/* Secondary status band (<details>): hidden summary + always-open body on desktop;
   collapsed body + tappable summary on phones. The min-width rule overrides the UA
   "closed <details> hides its body" rule, so ≥480px stays expanded without an open attr. */
.vc-foot{border-top:1px solid var(--border-subtle);background:var(--surface-inset)}
.vc-foot-body{padding:14px 20px}
.vc-foot-caret{width:8px;height:8px;flex:none;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);transition:transform var(--duration-base) var(--ease-standard)}
.vc-foot[open] .vc-foot-caret{transform:rotate(-135deg)}
/* Base = phone: tappable summary; body collapsed by the UA rule unless [open].
   Mobile is the default (no max-width query) so there is no dead zone at 479–480px. */
.vc-foot-sum{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 20px;list-style:none;cursor:pointer;font-family:var(--font-ui);font-size:12.5px;font-weight:800;letter-spacing:0.02em;color:var(--text-muted)}
.vc-foot-sum::-webkit-details-marker{display:none}
.vc-foot[open] > .vc-foot-body{display:flex;flex-direction:column;align-items:flex-start;gap:14px}
/* Desktop: drop the summary, force the body expanded regardless of [open]
   (author rule beats the UA "closed <details> hides its body" rule). */
@media (min-width:480px){
  .vc-foot-sum{display:none}
  .vc-foot-body{display:flex;flex-wrap:wrap;align-items:center;gap:14px 26px}
}
@media (prefers-reduced-motion:reduce){.vc-foot-caret{transition:none!important}}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 1160, margin: "0 auto", display: "flex", flexDirection: "column", gap: 26, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  overline: { display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", color: "var(--brand)", textTransform: "uppercase", marginBottom: 12 },
  overlineDot: { width: 7, height: 7, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  h1: { margin: 0, lineHeight: 1.04, fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-primary)", textWrap: "balance" },
  sub: { margin: "12px 0 0", fontSize: 17, lineHeight: 1.5, color: "var(--text-muted)", maxWidth: "56ch" },

  // Plan panel
  plan: { display: "flex", flexDirection: "column", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", overflow: "hidden" },
  planMain: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, padding: "18px 20px" },
  planStats: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 22px" },
  stat: { display: "flex", flexDirection: "column", gap: 2, minWidth: 80 },
  statNum: { fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1, color: "var(--text-primary)" },
  // Word-value variant (e.g. "Unlimited") — smaller than the numeric stats so it fits the cell.
  statText: { fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em", lineHeight: 1.35, color: "var(--text-primary)" },
  streakNum: { color: "var(--streak)", display: "inline-flex", alignItems: "center", gap: 6 },
  statSmall: { fontSize: 13, color: "var(--text-muted)", fontWeight: 700 },
  statLabel: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" },
  planCta: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  rescueCta: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44, padding: "8px 14px", borderRadius: "var(--radius-full)", border: "2px solid transparent", background: "var(--error-subtle)", color: "var(--error-text)", fontSize: 13, fontWeight: 800, textDecoration: "none", transition: "var(--transition-colors)" },
  caughtUp: { display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 700, color: "var(--success-text)" },
  // Без фикс-высоты: колонка = столбик (до 38px) + зазор + подпись (~14px) ≈ 56px,
  // жёсткие 44px резали подписи дней нижней кромкой панели (overflow:hidden).
  sparkWrap: { display: "flex", flexDirection: "column", gap: 7 },
  sparkCaption: { display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.02em", color: "var(--text-muted)" },
  spark: { display: "flex", alignItems: "flex-end", gap: 5 },
  sparkCol: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
  sparkBar: { width: 14, borderRadius: "4px 4px 2px 2px", display: "block" },
  sparkTick: { fontStyle: "normal", fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 700 },
  bank: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 },
  bankItem: { display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: "var(--text-secondary)" },
  bankDotI: { width: 9, height: 9, borderRadius: 3, flex: "none", display: "block" },
  bankTotal: { fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" },

  // Weak-type rail (V10)
  rail: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "15px 18px", borderRadius: "var(--radius-lg)", background: "var(--info-subtle)", border: "2px solid color-mix(in oklab, var(--info) 45%, transparent)" },
  railIcon: { width: 40, height: 40, flex: "none", borderRadius: "var(--radius-md)", background: "var(--surface)", color: "var(--info-text)", display: "grid", placeItems: "center" },
  railText: { flex: 1, minWidth: 220, margin: 0, fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.45 },
  railStrong: { color: "var(--text-primary)" },

  // My words (P11) — слим-карта-ссылка.
  myWords: { display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderRadius: "var(--radius-lg)", background: "var(--surface)", border: "2px solid var(--border)", boxShadow: "var(--shadow-solid)", textDecoration: "none", color: "inherit", transition: "transform var(--duration-base) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard)" },
  myWordsIcon: { width: 40, height: 40, flex: "none", borderRadius: "var(--radius-md)", background: "var(--brand-subtle)", color: "var(--text-link)", display: "grid", placeItems: "center" },
  myWordsTitle: { fontFamily: "var(--font-ui)", fontSize: 15.5, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--text-primary)" },
  myWordsSub: { fontSize: 13, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },

  empty: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "40px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, lineHeight: 1.5, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", maxWidth: "52ch", marginInline: "auto" },
  emptyIcon: { display: "grid", placeItems: "center", width: 52, height: 52, borderRadius: "50%", background: "var(--brand-subtle)", color: "var(--text-link)", marginBottom: 4 },
  emptyTitle: { fontFamily: "var(--font-ui)", fontSize: 17, fontWeight: 700, color: "var(--text-primary)" },

  grid: {},

  // Уровневые секции (0039): заголовок в обычном потоке + бейдж «Recommended».
  sections: { display: "flex", flexDirection: "column", gap: 30 },
  section: { display: "flex", flexDirection: "column", gap: 14 },
  sectionHead: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  sectionTitle: { margin: 0, fontFamily: "var(--font-ui)", fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--text-primary)" },
  recoChip: { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: "var(--radius-full)", background: "var(--brand-subtle)", color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 800 },

  card: { display: "flex", flexDirection: "column", gap: 12, textAlign: "left", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 20, color: "inherit", transition: "transform var(--duration-base) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)" },
  cardTop: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  lockBadge: { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: "var(--radius-full)", border: "1px solid var(--border)", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700 },
  cardTitle: { fontSize: 18, fontWeight: 800, letterSpacing: "-0.015em", color: "var(--text-primary)" },
  cardDesc: { margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--text-muted)" },

  progressRow: { display: "flex", flexDirection: "column", gap: 6, marginTop: "auto" },
  progressTrack: { position: "relative", display: "block", height: 7, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden" },
  progressFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  progressLabel: { fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" },
  progressEmpty: { marginTop: "auto", fontSize: 12.5, color: "var(--text-disabled)" },
  lockTeaser: { marginTop: "auto", fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" },

  cardFoot: { marginTop: 4, display: "flex", alignItems: "center", gap: 14 },
  startFoot: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, textDecoration: "none" },
  maintainFoot: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--success-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, textDecoration: "none" },
  lockFoot: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, textDecoration: "none" },
  browseFoot: { display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, textDecoration: "none" },
};
