import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getProfile, requireUser } from "@/lib/auth";
import { db } from "@/db";
import { region } from "@/db/schema";
import { periodLabel } from "@/lib/labels";
import {
  readLeaderboard,
  type LeaderRow,
  type Period,
} from "@/lib/progress/leaderboard";
import { AppShell } from "../_AppShell";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import LeaderboardControls from "./LeaderboardControls";

export const dynamic = "force-dynamic";

const PERIODS: Period[] = ["weekly", "monthly", "all_time"];

function asPeriod(v: string | undefined): Period {
  return PERIODS.includes(v as Period) ? (v as Period) : "all_time";
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const firstName = (n: string) => (n || "—").split(" ")[0];

function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((w) => w[0]).join("") || "—").toUpperCase();
}

function medalColor(rank: number): string | null {
  return rank === 1 ? "var(--gold-500)" : rank === 2 ? "var(--slate-300)" : rank === 3 ? "var(--orange-500)" : null;
}

/**
 * League tiers — детерминированная классификация реального Elo-рейтинга в
 * именованные лиги (НЕ выдуманная недельная промо-механика: чистая функция над
 * существующим `profile.rating`). Старт 1000 → Amethyst (брендовая «домашняя»
 * лига); путь наверх честно завязан на рост рейтинга.
 */
interface Tier {
  key: string;
  name: string;
  color: string;
  min: number;
}
const TIERS: Tier[] = [
  { key: "bronze", name: "Bronze", color: "var(--streak)", min: 0 },
  { key: "amethyst", name: "Amethyst", color: "var(--brand)", min: 950 },
  { key: "ruby", name: "Ruby", color: "var(--error)", min: 1150 },
  { key: "diamond", name: "Diamond", color: "var(--gold-500)", min: 1350 },
];
function tierIndex(rating: number): number {
  let idx = 0;
  for (let i = 0; i < TIERS.length; i++) if (rating >= TIERS[i].min) idx = i;
  return idx;
}

export default async function Leaderboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; scope?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const period = asPeriod(sp.period);
  const profile = await getProfile();

  // Scope chips: always "global"; add the user's region (+ its country ancestor)
  // if any. Region has public RLS read, so the anon client may fetch names by id.
  const scopeOptions: { value: string; label: string }[] = [
    { value: "global", label: "Global" },
  ];
  if (profile?.region_id) {
    // own + его parent одним self-join (parent зависит от own.parent_id — водопад
    // сворачиваем в один запрос). Owner-path: region — публичные имена территорий.
    const parentRegion = alias(region, "parent_region");
    const [row] = await db
      .select({
        ownId: region.id,
        ownName: region.name,
        parentId: parentRegion.id,
        parentName: parentRegion.name,
      })
      .from(region)
      .leftJoin(parentRegion, eq(parentRegion.id, region.parentId))
      .where(eq(region.id, profile.region_id))
      .limit(1);
    if (row) {
      if (row.parentId && row.parentName) {
        scopeOptions.push({ value: row.parentId, label: row.parentName });
      }
      scopeOptions.push({ value: row.ownId, label: row.ownName });
    }
  }

  const validScopes = new Set(scopeOptions.map((o) => o.value));
  const scope = sp.scope && validScopes.has(sp.scope) ? sp.scope : "global";

  const { rows, viewerRow } = await readLeaderboard(period, scope, profile?.id);

  const showScore = period !== "all_time";
  const viewerPinned = !!viewerRow && !rows.some((r) => r.userId === viewerRow.userId);
  const viewer = viewerRow ?? rows.find((r) => r.isViewer) ?? null;
  const nextUp = viewer ? rows.find((r) => r.rank === viewer.rank - 1) ?? null : null;
  const val = (r: LeaderRow) => (showScore ? r.score : r.rating);
  const total = rows.length + (viewerPinned ? 1 : 0);

  const scopeLabel = scopeOptions.find((o) => o.value === scope)?.label ?? "Global";
  const rating = profile?.rating ?? 1000;
  const tIdx = tierIndex(rating);
  const nextTier = TIERS[tIdx + 1] ?? null;

  return (
    <AppShell active="leaderboard">
      <style>{LB_CSS}</style>
      <div style={S.arena}>
        <div className="lb-wrap" style={S.wrap}>
          {/* Header */}
          <div style={S.head}>
            <span style={S.crown}>
              <Icon name="crown" size={22} style={{ color: "var(--text-on-brand)" }} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={S.h1}>{scopeLabel} League</h1>
              <div style={S.sub}>{showScore ? `XP · ${periodLabel(period)}` : "Ranked by Elo rating"}</div>
            </div>
          </div>

          <LeaderboardControls
            period={period}
            scope={scope}
            periodOptions={PERIODS.map((p) => ({ value: p, label: periodLabel(p) }))}
            scopeOptions={scopeOptions}
          />
          <p style={S.scopeNote}>Compete locally first, then climb to your city, country, and global boards.</p>

          {rows.length === 0 ? (
            <div style={S.empty}>No ranking yet — sit a rated test to enter the league.</div>
          ) : (
            <div className="lb-grid" style={S.grid}>
              {/* Ranked board */}
              <div style={S.list}>
                {rows.map((r) => (
                  <RowItem key={r.userId} row={r} showScore={showScore} />
                ))}
                {viewerPinned && viewerRow ? (
                  <>
                    <div style={S.divider} />
                    <RowItem row={viewerRow} showScore={showScore} />
                  </>
                ) : null}
              </div>

              {/* Side: tiers + standing */}
              <div style={S.side}>
                <TiersCard activeIdx={tIdx} rating={rating} nextTier={nextTier} />
                <StandingCard
                  viewer={viewer}
                  nextUp={nextUp}
                  total={total}
                  showScore={showScore}
                  val={val}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* Tier ladder — реальный рейтинг → именованная лига; «You're here» на текущей. */
function TiersCard({
  activeIdx,
  rating,
  nextTier,
}: {
  activeIdx: number;
  rating: number;
  nextTier: Tier | null;
}) {
  return (
    <div style={S.card}>
      <div style={S.eyebrow}>Tiers</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {[...TIERS]
          .map((t, i) => ({ t, i }))
          .reverse()
          .map(({ t, i }) => {
            const here = i === activeIdx;
            return (
              <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 11, opacity: here ? 1 : 0.55 }}>
                <span style={{ width: 30, height: 30, flex: "none", borderRadius: 9, display: "grid", placeItems: "center", background: `color-mix(in oklab, ${t.color} 18%, var(--surface))`, color: t.color }}>
                  <Icon name="trophy" size={16} strokeWidth={2.2} />
                </span>
                <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: here ? 800 : 600, color: "var(--text-primary)" }}>
                  {t.name}
                </span>
                {here && (
                  <span style={S.herePill}>You&apos;re here</span>
                )}
              </div>
            );
          })}
      </div>
      <div style={S.tierFoot}>
        <span>
          Your rating <span style={{ fontFamily: "var(--font-mono)", color: "var(--brand)", fontWeight: 600 }}>{rating}</span>
        </span>
        {nextTier && (
          <span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--brand-active)", fontWeight: 600 }}>{nextTier.min - rating}</span> to {nextTier.name}
          </span>
        )}
      </div>
    </div>
  );
}

/* Your standing — реальный ранг/из скольких + дистанция до следующего. */
function StandingCard({
  viewer,
  nextUp,
  total,
  showScore,
  val,
}: {
  viewer: LeaderRow | null;
  nextUp: LeaderRow | null;
  total: number;
  showScore: boolean;
  val: (r: LeaderRow) => number;
}) {
  if (!viewer) {
    return (
      <div style={S.standing}>
        <div style={S.standingEyebrow}>Your standing</div>
        <p style={S.standingEmpty}>You&apos;re not ranked yet — sit a rated test to claim your spot.</p>
        <Button fullWidth trailingIcon="arrow-right" href="/app/reading" style={{ justifyContent: "center", marginTop: 14 }}>
          Practise
        </Button>
      </div>
    );
  }

  const gap = nextUp ? val(nextUp) - val(viewer) : 0;
  const pct = nextUp && val(nextUp) > 0 ? Math.min(100, Math.round((val(viewer) / val(nextUp)) * 100)) : 100;
  return (
    <div style={S.standing}>
      <div style={S.standingEyebrow}>Your standing</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={S.standingRank}>#{viewer.rank}</span>
        <span style={S.standingOf}>of {total}</span>
      </div>
      <div style={S.standingTrack}>
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: "var(--radius-full)", background: "var(--brand)" }} />
      </div>
      <div style={S.standingHint}>
        {nextUp ? (
          <>
            <b style={{ fontFamily: "var(--font-mono)", color: "var(--brand-active)" }}>
              {fmt(gap)} {showScore ? "XP" : "pts"}
            </b>{" "}
            to overtake {firstName(nextUp.displayName)} → #{nextUp.rank}
          </>
        ) : (
          "Top of the league 🏆"
        )}
      </div>
      <Button fullWidth trailingIcon="arrow-right" href="/app/reading" style={{ justifyContent: "center", marginTop: 14 }}>
        Practise
      </Button>
    </div>
  );
}

function RowItem({ row, showScore }: { row: LeaderRow; showScore: boolean }) {
  const medal = medalColor(row.rank);
  return (
    <div style={{ ...S.lrow, ...(row.isViewer ? S.lrowYou : null) }}>
      <div style={{ ...S.rk, ...(medal ? { color: medal } : null) }}>{row.rank}</div>
      <div
        style={{
          ...S.av,
          ...(medal
            ? { background: `color-mix(in oklab, ${medal} 80%, white)`, color: "#1a1525", boxShadow: `0 0 0 2px ${medal}` }
            : null),
        }}
      >
        {initials(row.displayName)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...S.nm, fontWeight: row.isViewer ? 800 : 600 }}>
          {row.displayName || "—"}
          {row.isViewer && <span style={{ color: "var(--brand-active)", fontWeight: 700 }}> · you</span>}
        </div>
        {row.regionName && <div style={S.region}>{row.regionName}</div>}
      </div>
      <div style={S.xp}>
        {fmt(showScore ? row.score : row.rating)}
        <span style={S.xpUnit}>{showScore ? " XP" : ""}</span>
      </div>
    </div>
  );
}

// Адаптив лидерборда. База = мобильный (доска и сайдбар в стек); ≥768px = десктоп.
const LB_CSS = `
.lb-wrap{padding:22px 16px 40px}
.lb-grid{display:grid;grid-template-columns:1fr;gap:16px}
@media (min-width:768px){
  .lb-wrap{padding:26px 28px 44px}
  .lb-grid{grid-template-columns:1.5fr 1fr;gap:20px}
}
`;

const S: Record<string, React.CSSProperties> = {
  arena: { minHeight: "100%", background: "radial-gradient(120% 80% at 50% -8%, color-mix(in oklab, var(--brand) 14%, white) 0%, var(--bg-base) 52%)" },
  wrap: { maxWidth: 960, margin: "0 auto" },
  head: { display: "flex", alignItems: "center", gap: 13, marginBottom: 16 },
  crown: { width: 44, height: 44, flex: "none", borderRadius: 13, display: "grid", placeItems: "center", background: "linear-gradient(165deg, var(--brand), var(--brand-active))", boxShadow: "0 0 26px -4px color-mix(in oklab, var(--brand) 80%, transparent)" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: 0 },
  sub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)" },
  scopeNote: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: "0 2px 16px" },

  grid: { alignItems: "start" },
  list: { display: "flex", flexDirection: "column", gap: 7 },
  divider: { height: 1, background: "var(--border)", margin: "4px 0" },

  lrow: { display: "flex", alignItems: "center", gap: 13, padding: "11px 15px", background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-md)" },
  lrowYou: { background: "var(--brand-subtle)", borderColor: "var(--brand)", boxShadow: "0 0 28px -8px color-mix(in oklab, var(--brand) 70%, transparent)" },
  rk: { width: 24, flex: "none", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-muted)" },
  av: { width: 38, height: 38, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, background: "var(--surface-hover)", color: "var(--text-secondary)", boxShadow: "inset 0 0 0 1px var(--border)" },
  nm: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  region: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", marginTop: 1 },
  xp: { flex: "none", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-primary)" },
  xpUnit: { fontSize: "var(--text-2xs)", color: "var(--text-muted)" },

  side: { display: "flex", flexDirection: "column", gap: 14 },
  card: { background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "18px 20px", boxShadow: "var(--shadow-sm)" },
  eyebrow: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)" },
  herePill: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--brand-active)", background: "var(--brand-subtle)", borderRadius: "var(--radius-full)", padding: "3px 9px", whiteSpace: "nowrap" },
  tierFoot: { display: "flex", flexDirection: "column", gap: 4, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },

  standing: { background: "linear-gradient(180deg, var(--brand-subtle), var(--surface))", border: "2px solid var(--brand-border)", borderRadius: "var(--radius-xl)", padding: "18px 20px", boxShadow: "var(--shadow-md)" },
  standingEyebrow: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--brand-active)", marginBottom: 8 },
  standingRank: { fontFamily: "var(--font-ui)", fontSize: 42, fontWeight: 900, color: "var(--brand)", lineHeight: 1, letterSpacing: "-0.03em" },
  standingOf: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)" },
  standingTrack: { height: 9, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden", margin: "12px 0 8px" },
  standingHint: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },
  standingEmpty: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", lineHeight: 1.5, color: "var(--text-secondary)", margin: "0" },

  empty: { marginTop: 24, padding: "2rem", textAlign: "center", color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
};
