import Link from "next/link";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { periodLabel } from "@/lib/labels";
import {
  readLeaderboard,
  type LeaderRow,
  type Period,
} from "@/lib/progress/leaderboard";
import LeaderboardControls from "./LeaderboardControls";

export const dynamic = "force-dynamic";

const PERIODS: Period[] = ["weekly", "monthly", "all_time"];

function asPeriod(v: string | undefined): Period {
  return PERIODS.includes(v as Period) ? (v as Period) : "all_time";
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

  // Scope chip options: always "global"; if the user has a region, offer that
  // region (and its country ancestor). Region has public RLS read, so the anon
  // client may fetch names by id.
  const scopeOptions: { value: string; label: string }[] = [
    { value: "global", label: "Весь мир" },
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
  const viewerPinned =
    viewerRow && !rows.some((r) => r.userId === viewerRow.userId);

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <Link href="/app" style={S.back}>
          ← Дашборд
        </Link>
        <h1 style={S.h1}>Лидерборд</h1>
        <p style={S.sub}>
          {showScore
            ? "Очки за выбранный период."
            : "Глобальный рейтинг Elo."}
        </p>

        <LeaderboardControls
          period={period}
          scope={scope}
          periodOptions={PERIODS.map((p) => ({
            value: p,
            label: periodLabel(p),
          }))}
          scopeOptions={scopeOptions}
        />

        {rows.length === 0 ? (
          <div style={S.empty}>
            Пока пусто — пройди тест, чтобы попасть в рейтинг.
          </div>
        ) : (
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
        )}
      </div>
    </main>
  );
}

function RowItem({ row, showScore }: { row: LeaderRow; showScore: boolean }) {
  return (
    <div
      style={{
        ...S.row,
        ...(row.isViewer ? S.rowViewer : {}),
      }}
    >
      <div style={S.rank}>#{row.rank}</div>
      <div style={S.who}>
        <div style={S.name}>{row.displayName || "—"}</div>
        {row.regionName ? (
          <div style={S.region}>{row.regionName}</div>
        ) : null}
      </div>
      <div style={S.value}>{showScore ? row.score : row.rating}</div>
    </div>
  );
}

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", padding: "2rem 1.25rem 4rem", fontFamily: FONT },
  wrap: { maxWidth: 720, margin: "0 auto" },
  back: { color: "#6C5CE7", fontSize: ".9rem" },
  h1: { fontSize: "1.8rem", margin: ".5rem 0 .25rem" },
  sub: { color: "#777", margin: "0 0 1.25rem" },
  list: { display: "grid", gap: ".5rem", marginTop: "1.25rem" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: ".9rem",
    border: "1px solid #ececf1",
    borderRadius: 10,
    padding: ".8rem .9rem",
    background: "#fff",
  },
  rowViewer: {
    borderColor: "#6C5CE7",
    background: "#f6f4ff",
  },
  rank: {
    fontWeight: 800,
    fontSize: ".95rem",
    color: "#6C5CE7",
    minWidth: 40,
  },
  who: { flex: 1, minWidth: 0 },
  name: {
    fontWeight: 700,
    fontSize: ".95rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  region: { color: "#999", fontSize: ".78rem", marginTop: ".15rem" },
  value: { fontWeight: 800, fontSize: "1rem", color: "#0f172a" },
  divider: {
    height: 1,
    background: "#ececf1",
    margin: ".35rem 0",
  },
  empty: {
    marginTop: "1.5rem",
    padding: "2rem",
    textAlign: "center",
    color: "#999",
    border: "1px dashed #ddd",
    borderRadius: 12,
  },
};
