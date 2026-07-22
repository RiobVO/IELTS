import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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

function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((w) => w[0]).join("") || "—").toUpperCase();
}

function medalColor(rank: number): string | null {
  return rank === 1 ? "var(--gold-500)" : rank === 2 ? "var(--slate-300)" : rank === 3 ? "var(--orange-500)" : null;
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
    const supabase = await createClient();
    const { data: own } = await supabase
      .from("region")
      .select("id,name,parent_id")
      .eq("id", profile.region_id)
      .single();
    if (own) {
      if (own.parent_id) {
        const { data: parent } = await supabase
          .from("region")
          .select("id,name")
          .eq("id", own.parent_id)
          .single();
        if (parent) {
          scopeOptions.push({ value: parent.id, label: parent.name });
        }
      }
      scopeOptions.push({ value: own.id, label: own.name });
    }
  }

  const validScopes = new Set(scopeOptions.map((o) => o.value));
  const scope = sp.scope && validScopes.has(sp.scope) ? sp.scope : "global";

  const { rows, viewerRow } = await readLeaderboard(period, scope, profile?.id);

  const showScore = period !== "all_time";
  const viewerPinned = viewerRow && !rows.some((r) => r.userId === viewerRow.userId);
  const viewer = viewerRow ?? rows.find((r) => r.isViewer) ?? null;
  const nextUp = viewer ? rows.find((r) => r.rank === viewer.rank - 1) ?? null : null;
  const val = (r: LeaderRow) => (showScore ? r.score : r.rating);
  const top3 = rows.slice(0, 3);

  return (
    <AppShell active="leaderboard">
      <div style={S.arena}>
        <div style={S.wrap}>
          {/* Header */}
          <div style={S.head}>
            <span style={S.crown}>
              <Icon name="crown" size={24} style={{ color: "var(--text-on-brand)" }} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={S.h1}>Leaderboard</h1>
              <div style={S.sub}>{showScore ? `XP · ${periodLabel(period)}` : "Global Elo rating"}</div>
            </div>
          </div>

          <LeaderboardControls
            period={period}
            scope={scope}
            periodOptions={PERIODS.map((p) => ({ value: p, label: periodLabel(p) }))}
            scopeOptions={scopeOptions}
          />

          {rows.length === 0 ? (
            <div style={S.empty}>No ranking yet — take a test to enter the league.</div>
          ) : (
            <>
              {/* Podium (top 3) */}
              {top3.length >= 3 && (
                <div style={S.podium}>
                  <PodiumCol row={top3[1]} place={0} showScore={showScore} />
                  <PodiumCol row={top3[0]} place={1} showScore={showScore} />
                  <PodiumCol row={top3[2]} place={2} showScore={showScore} />
                </div>
              )}

              {/* YOU hero */}
              {viewer && (
                <div style={S.youHero}>
                  <div style={{ flex: "none", textAlign: "center" }}>
                    <div style={S.youLabel}>Your rank</div>
                    <div style={S.youRank}>#{viewer.rank}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {nextUp ? (
                      <div style={S.youNext}>
                        <b style={S.youNextNum}>
                          {fmt(val(nextUp) - val(viewer))}
                          {showScore ? " XP" : " pts"}
                        </b>{" "}
                        to overtake {nextUp.displayName.split(" ")[0]} → climb to #{nextUp.rank}
                      </div>
                    ) : (
                      <div style={S.youNext}>You&apos;re at the top of the league 🏆</div>
                    )}
                  </div>
                  <Button href="/app/reading" trailingIcon="arrow-right" style={{ flex: "none" }}>
                    Practise
                  </Button>
                </div>
              )}

              {/* Ranked list */}
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
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function PodiumCol({ row, place, showScore }: { row: LeaderRow; place: 0 | 1 | 2; showScore: boolean }) {
  const heights = [120, 168, 96];
  const medal = place === 1 ? "var(--gold-500)" : place === 0 ? "var(--slate-300)" : "var(--orange-500)";
  const av = place === 1 ? 78 : 60;
  const value = showScore ? row.score : row.rating;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      {place === 1 && <Icon name="crown" size={30} style={{ color: "var(--gold-500)" }} />}
      <div style={{ position: "relative" }}>
        <div style={{ width: av, height: av, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--surface-hover)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: place === 1 ? 22 : 16, boxShadow: `0 0 0 3px ${medal}`, border: row.isViewer ? "2px solid var(--brand)" : "none" }}>
          {initials(row.displayName)}
        </div>
        <span style={{ position: "absolute", bottom: -7, left: "50%", transform: "translateX(-50%)", width: 24, height: 24, borderRadius: "50%", background: medal, color: "#1a1525", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, border: "2px solid var(--bg-base)" }}>{row.rank}</span>
      </div>
      <div style={{ textAlign: "center", marginTop: 2 }}>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: row.isViewer ? "var(--text-link)" : "var(--text-primary)", whiteSpace: "nowrap", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis" }}>
          {(row.displayName || "—").split(" ")[0]}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", fontWeight: 600, color: medal }}>
          {fmt(value)}{showScore ? " XP" : ""}
        </div>
      </div>
      <div style={{ position: "relative", width: "100%", height: heights[place], borderRadius: "14px 14px 0 0", background: place === 1 ? "linear-gradient(180deg, var(--brand), var(--brand-active))" : "linear-gradient(180deg, var(--surface-raised), var(--surface))", border: "2px solid", borderColor: place === 1 ? "var(--brand-border)" : "var(--border)", borderBottom: "none" }}>
        <div style={{ position: "absolute", top: 12, left: 0, right: 0, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: place === 1 ? 30 : 22, fontWeight: 700, color: place === 1 ? "var(--text-on-brand)" : "var(--text-muted)" }}>{row.rank}</div>
      </div>
    </div>
  );
}

function RowItem({ row, showScore }: { row: LeaderRow; showScore: boolean }) {
  const medal = medalColor(row.rank);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 15px", background: row.isViewer ? "var(--brand-subtle)" : "var(--surface)", border: `1.5px solid ${row.isViewer ? "var(--brand)" : "var(--border)"}`, borderRadius: "var(--radius-md)" }}>
      <div style={{ width: 24, flex: "none", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 700, color: medal || "var(--text-muted)" }}>{row.rank}</div>
      <div style={{ width: 38, height: 38, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", background: medal ? `color-mix(in oklab, ${medal} 80%, white)` : "var(--surface-hover)", color: medal ? "#1a1525" : "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, boxShadow: medal ? `0 0 0 2px ${medal}` : "inset 0 0 0 1px var(--border)" }}>{initials(row.displayName)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: row.isViewer ? 800 : 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.displayName || "—"}
          {row.isViewer && <span style={{ color: "var(--text-link)" }}> · you</span>}
        </div>
        {row.regionName && <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", marginTop: 1 }}>{row.regionName}</div>}
      </div>
      <div style={{ flex: "none", textAlign: "right", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-base)", fontWeight: 600, color: row.isViewer ? "var(--text-link)" : "var(--text-primary)" }}>
        {fmt(showScore ? row.score : row.rating)}
        {showScore && <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-muted)" }}> XP</span>}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  arena: { minHeight: "100%", background: "radial-gradient(120% 80% at 50% -8%, color-mix(in oklab, var(--brand) 14%, white) 0%, var(--bg-base) 52%)" },
  wrap: { maxWidth: 720, margin: "0 auto", padding: "26px 28px 44px" },
  head: { display: "flex", alignItems: "center", gap: 13, marginBottom: 16 },
  crown: { width: 46, height: 46, flex: "none", borderRadius: 14, display: "grid", placeItems: "center", background: "linear-gradient(165deg, var(--brand), var(--brand-active))", boxShadow: "0 0 28px -4px color-mix(in oklab, var(--brand) 80%, transparent)" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: 0 },
  sub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)" },

  podium: { display: "grid", gridTemplateColumns: "1fr 1.12fr 1fr", alignItems: "end", gap: 12, marginTop: 8, marginBottom: 4 },

  youHero: { display: "flex", alignItems: "center", gap: 18, background: "linear-gradient(180deg, var(--brand-subtle), var(--surface))", border: "2px solid var(--brand-border)", borderRadius: "var(--radius-xl)", padding: "18px 22px", margin: "18px 0 8px", boxShadow: "var(--shadow-lg)" },
  youLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-link)" },
  youRank: { fontFamily: "var(--font-ui)", fontSize: 52, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.03em", color: "var(--brand)" },
  youNext: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },
  youNextNum: { color: "var(--text-link)", fontFamily: "var(--font-mono)" },

  list: { display: "flex", flexDirection: "column", gap: 7, marginTop: 10 },
  divider: { height: 1, background: "var(--border)", margin: "4px 0" },
  empty: { marginTop: 24, padding: "2rem", textAlign: "center", color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
};
