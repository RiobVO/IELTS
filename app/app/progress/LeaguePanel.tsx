import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getProfile, requireUser } from "@/lib/auth";
import { getHeaderData } from "@/lib/notifications/header-data";
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
import { LeagueMotion } from "./LeagueMotion";
import { ProgressTabs } from "./ProgressTabs";

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

// Deterministic avatar tint from the user id — identity + visual variety without
// stored avatars (the medal colours still override the top 3).
const AVATAR_COLORS = ["var(--violet-600)", "var(--sky-500)", "var(--green-500)", "var(--gold-500)", "var(--orange-500)", "var(--error)"];
function avatarColor(id: string): string {
  let s = 0;
  for (let i = 0; i < id.length; i++) s += id.charCodeAt(i);
  return AVATAR_COLORS[s % AVATAR_COLORS.length];
}

/**
 * League tiers — детерминированная классификация реального Elo-рейтинга в
 * именованные лиги (чистая функция над `profile.rating`).
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

export async function LeaguePanel({
  period: periodParam,
  scope: scopeParam,
}: {
  period?: string;
  scope?: string;
}) {
  await requireUser();
  // Пре-варм данных шапки конкурентно с телом страницы (cache()'d; AppShell reuses).
  void getHeaderData();
  const sp = { period: periodParam, scope: scopeParam };
  const period = asPeriod(sp.period);
  const profile = await getProfile();

  const scopeOptions: { value: string; label: string }[] = [{ value: "global", label: "Global" }];
  if (profile?.region_id) {
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
      if (row.parentId && row.parentName) scopeOptions.push({ value: row.parentId, label: row.parentName });
      scopeOptions.push({ value: row.ownId, label: row.ownName });
    }
  }

  const validScopes = new Set(scopeOptions.map((o) => o.value));
  const scope = sp.scope && validScopes.has(sp.scope) ? sp.scope : "global";
  const scopeLabel = scopeOptions.find((o) => o.value === scope)?.label ?? "Global";

  // regionName for the board rows = the scope's region name (null for global, so
  // rows don't print "Global" under every player). Already resolved above for the
  // scope switcher — thread it in so readLeaderboard doesn't re-query the region.
  const { rows, viewerRow } = await readLeaderboard(
    period,
    scope,
    scope === "global" ? null : scopeLabel,
    profile?.id,
  );

  const showScore = period !== "all_time";
  const viewerPinned = !!viewerRow && !rows.some((r) => r.userId === viewerRow.userId);
  const viewer = viewerRow ?? rows.find((r) => r.isViewer) ?? null;
  const nextUp = viewer ? rows.find((r) => r.rank === viewer.rank - 1) ?? null : null;
  const val = (r: LeaderRow) => (showScore ? r.score : r.rating);
  const total = rows.length + (viewerPinned ? 1 : 0);

  const rating = profile?.rating ?? 1000;
  const tIdx = tierIndex(rating);
  const nextTier = TIERS[tIdx + 1] ?? null;

  // Podium for the top finishers (adaptive: 2 or 3 — same render at every scope,
  // so a regional board lights up the moment it has ≥2 ranked players); the rest
  // list out below.
  const podium = rows.length >= 2 ? rows.slice(0, Math.min(3, rows.length)) : [];
  const listRows = podium.length ? rows.slice(podium.length) : rows;

  return (
    <AppShell active="progress">
      <style>{LB_CSS}</style>
      <div data-league-root style={S.arena}>
        <div className="lb-wrap" style={S.wrap}>
          <ProgressTabs tab="league" />
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
            <>
              {podium.length > 0 && <Podium top={podium} showScore={showScore} />}

              <div className="lb-grid" style={S.grid}>
                {/* Ranked board */}
                <div style={{ minWidth: 0 }}>
                  <ol style={S.list}>
                    {listRows.map((r) => (
                      <RowItem key={r.userId} row={r} showScore={showScore} />
                    ))}
                  </ol>
                  {viewerPinned && viewerRow ? (
                    <div style={S.pinned}>
                      <div style={S.pinnedLabel}>Your position</div>
                      <ol style={{ ...S.list, marginTop: 7 }}>
                        <RowItem row={viewerRow} showScore={showScore} />
                      </ol>
                    </div>
                  ) : null}
                </div>

                {/* Side: tiers + standing */}
                <div style={S.side}>
                  <TiersCard activeIdx={tIdx} rating={rating} nextTier={nextTier} />
                  <StandingCard viewer={viewer} nextUp={nextUp} total={total} showScore={showScore} val={val} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <LeagueMotion />
    </AppShell>
  );
}

/* Top-3 podium — pedestals rise on load; crown on #1, medal-tinted avatars. */
function Podium({ top, showScore }: { top: LeaderRow[]; showScore: boolean }) {
  const byRank = new Map(top.map((r) => [r.rank, r]));
  const three = top.length >= 3;
  // 3 finishers → classic 2·1·3; 2 finishers → 1·2 (winner on the left, taller).
  const order = (three
    ? [byRank.get(2), byRank.get(1), byRank.get(3)]
    : [byRank.get(1), byRank.get(2)]
  ).filter(Boolean) as LeaderRow[];
  const HEIGHT: Record<number, number> = { 1: 120, 2: 92, 3: 70 };
  return (
    <div
      style={{
        ...S.podium,
        gridTemplateColumns: three ? "1fr 1.15fr 1fr" : "1fr 1fr",
        ...(three ? null : { maxWidth: 520, marginLeft: "auto", marginRight: "auto" }),
      }}
    >
      {order.map((r) => {
        const medal = medalColor(r.rank)!;
        return (
          <div key={r.userId} style={S.pod}>
            {r.rank === 1 && (
              <span style={{ color: "var(--gold-500)", marginBottom: 4 }}>
                <Icon name="crown" size={18} strokeWidth={2.2} />
              </span>
            )}
            <div style={{ ...S.podAv, background: avatarColor(r.userId), ...(r.isViewer ? { boxShadow: "0 0 0 3px var(--brand)" } : null) }}>
              {initials(r.displayName)}
              <span style={{ ...S.podRk, background: medal }}>{r.rank}</span>
            </div>
            <div style={S.podName}>{firstName(r.displayName)}</div>
            <div style={S.podXp}>
              {fmt(showScore ? r.score : r.rating)}
              {showScore ? " XP" : ""}
            </div>
            <div
              data-pedestal={HEIGHT[r.rank]}
              style={{ ...S.pedestal, height: HEIGHT[r.rank], background: `linear-gradient(180deg, color-mix(in oklab, ${medal} 70%, white), color-mix(in oklab, ${medal} 34%, white))` }}
            >
              #{r.rank}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Rank movement since the last snapshot. Null (no baseline yet) → render nothing. */
function Delta({ d }: { d: number | null }) {
  if (d == null) return null;
  if (d > 0)
    return (
      <span style={{ ...S.delta, ...S.deltaUp }}>
        <Icon name="chevron-up" size={11} strokeWidth={3} />
        {d}
      </span>
    );
  if (d < 0)
    return (
      <span style={{ ...S.delta, ...S.deltaDown }}>
        <Icon name="chevron-down" size={11} strokeWidth={3} />
        {-d}
      </span>
    );
  return <span style={{ ...S.delta, ...S.deltaFlat }}>–</span>;
}

function RowItem({ row, showScore }: { row: LeaderRow; showScore: boolean }) {
  const medal = medalColor(row.rank);
  return (
    <li data-row style={{ ...S.lrow, ...(row.isViewer ? S.lrowYou : null) }}>
      <div style={{ ...S.rk, ...(medal ? { color: medal } : null) }}>{row.rank}</div>
      <div
        style={{
          ...S.av,
          background: avatarColor(row.userId),
          ...(medal ? { boxShadow: `0 0 0 2px ${medal}` } : null),
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
      <Delta d={row.delta} />
      <div style={S.xp}>
        {fmt(showScore ? row.score : row.rating)}
        <span style={S.xpUnit}>{showScore ? " XP" : ""}</span>
      </div>
    </li>
  );
}

/* Tier ladder — реальный рейтинг → именованная лига; «You're here» на текущей.
   Неактивные тиры приглушены ТОКЕНОМ (--text-muted, AA), не opacity (контраст). */
function TiersCard({ activeIdx, rating, nextTier }: { activeIdx: number; rating: number; nextTier: Tier | null }) {
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
              <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <span style={{ width: 30, height: 30, flex: "none", borderRadius: 9, display: "grid", placeItems: "center", background: `color-mix(in oklab, ${t.color} 18%, var(--surface))`, color: t.color, ...(here ? null : { opacity: 0.7 }) }}>
                  <Icon name="trophy" size={16} strokeWidth={2.2} />
                </span>
                <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: here ? 800 : 600, color: here ? "var(--text-primary)" : "var(--text-muted)" }}>
                  {t.name}
                </span>
                {here && <span style={S.herePill}>You&apos;re here</span>}
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

/* Your standing — реальный ранг (count-up) + дистанция до следующего (chase-бар). */
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
        <span style={S.standingRank}>
          #<span data-countup={viewer.rank}>{viewer.rank}</span>
        </span>
        <span style={S.standingOf}>of {total}</span>
        <Delta d={viewer.delta} />
      </div>
      <div style={S.standingTrack}>
        <div data-fill={pct} style={{ height: "100%", width: `${pct}%`, borderRadius: "var(--radius-full)", background: "linear-gradient(90deg, var(--brand), var(--brand-hover))", transformOrigin: "left" }} />
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

// Адаптив лидерборда. База = мобильный (стек); ≥768px = десктоп.
const LB_CSS = `
.lb-wrap{padding:22px 16px 40px}
.lb-grid{display:grid;grid-template-columns:1fr;gap:16px}
@media (min-width:768px){
  .lb-wrap{padding:26px 28px 44px}
  .lb-grid{grid-template-columns:1.5fr 1fr;gap:20px}
}
`;

const S: Record<string, React.CSSProperties> = {
  arena: { minHeight: "100%", overflowX: "hidden", background: "radial-gradient(120% 80% at 50% -8%, color-mix(in oklab, var(--brand) 14%, white) 0%, var(--bg-base) 52%)" },
  wrap: { maxWidth: 960, margin: "0 auto", width: "100%" },
  head: { display: "flex", alignItems: "center", gap: 13, marginBottom: 16 },
  crown: { width: 44, height: 44, flex: "none", borderRadius: 13, display: "grid", placeItems: "center", background: "linear-gradient(165deg, var(--brand), var(--brand-active))", boxShadow: "0 0 26px -4px color-mix(in oklab, var(--brand) 80%, transparent)" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: 0 },
  sub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)" },
  scopeNote: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: "0 2px 16px" },

  podium: { display: "grid", gridTemplateColumns: "1fr 1.15fr 1fr", gap: 12, alignItems: "end", marginBottom: 18 },
  pod: { display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 },
  podAv: { position: "relative", width: 58, height: 58, borderRadius: "50%", display: "grid", placeItems: "center", fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: "var(--text-base)", color: "#fff", marginBottom: 8, boxShadow: "0 6px 16px -6px rgba(20,40,55,.4)" },
  podRk: { position: "absolute", bottom: -6, right: -6, width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: "#1a1525", border: "2px solid var(--bg-base)" },
  podName: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-sm)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" },
  podXp: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 9 },
  pedestal: { width: "100%", borderRadius: "var(--radius-md) var(--radius-md) 0 0", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 10, fontFamily: "var(--font-mono)", fontWeight: 700, color: "#fff", borderTop: "1px solid rgba(0,0,0,.05)" },

  grid: { alignItems: "start" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 7 },
  pinned: { marginTop: 12 },
  pinnedLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)" },

  lrow: { display: "flex", alignItems: "center", gap: 13, padding: "11px 15px", background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-md)" },
  lrowYou: { background: "var(--brand-subtle)", borderColor: "var(--brand)", boxShadow: "0 0 28px -8px color-mix(in oklab, var(--brand) 70%, transparent)" },
  rk: { width: 24, flex: "none", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-muted)" },
  av: { width: 38, height: 38, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, color: "#fff" },
  nm: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  region: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", marginTop: 1 },
  delta: { display: "inline-flex", alignItems: "center", gap: 1, flex: "none", fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", fontWeight: 700, padding: "2px 6px", borderRadius: "var(--radius-full)" },
  deltaUp: { color: "var(--success-text)", background: "var(--success-subtle)" },
  deltaDown: { color: "var(--error-text)", background: "var(--error-subtle)" },
  deltaFlat: { color: "var(--text-muted)", background: "var(--surface-inset)" },
  xp: { flex: "none", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-primary)" },
  xpUnit: { fontSize: "var(--text-2xs)", color: "var(--text-muted)" },

  side: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 },
  card: { background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "18px 20px", boxShadow: "var(--shadow-sm)" },
  eyebrow: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)" },
  herePill: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--brand-active)", background: "var(--brand-subtle)", borderRadius: "var(--radius-full)", padding: "3px 9px", whiteSpace: "nowrap" },
  tierFoot: { display: "flex", flexDirection: "column", gap: 4, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },

  standing: { background: "linear-gradient(180deg, var(--brand-subtle), var(--surface))", border: "2px solid var(--brand-border)", borderRadius: "var(--radius-xl)", padding: "18px 20px", boxShadow: "var(--shadow-md)" },
  standingEyebrow: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--brand-active)", marginBottom: 8 },
  standingRank: { fontFamily: "var(--font-ui)", fontSize: 42, fontWeight: 900, color: "var(--brand)", lineHeight: 1, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" },
  standingOf: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)" },
  standingTrack: { height: 9, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden", margin: "12px 0 8px" },
  standingHint: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },
  standingEmpty: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", lineHeight: 1.5, color: "var(--text-secondary)", margin: 0 },

  empty: { marginTop: 24, padding: "2rem", textAlign: "center", color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
};
