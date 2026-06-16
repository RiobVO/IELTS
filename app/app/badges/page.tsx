import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_AppShell";
import { Icon, type IconName } from "@/components/core/icons";

export const dynamic = "force-dynamic";

interface BadgeRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
}

interface UserBadgeRow {
  badge_id: string;
  earned_at: string;
}

export default async function BadgesPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // badge: PUBLIC read RLS. user_badge: OWNER-ONLY read (user_id = auth.uid()),
  // so this only ever returns the logged-in user's own earned rows. The explicit
  // .eq("user_id") is belt-and-suspenders defence-in-depth on top of RLS.
  const [{ data: badgeData }, { data: earnedData }] = await Promise.all([
    supabase.from("badge").select("id,code,name,description,icon"),
    supabase.from("user_badge").select("badge_id,earned_at").eq("user_id", user.id),
  ]);

  const badges = (badgeData ?? []) as BadgeRow[];
  const earned = (earnedData ?? []) as UserBadgeRow[];
  const earnedMap = new Map<string, string>(earned.map((e) => [e.badge_id, e.earned_at]));

  // Earned first, then locked; stable within each group by source order.
  const sorted = [...badges].sort((a, b) => {
    const ea = earnedMap.has(a.id) ? 0 : 1;
    const eb = earnedMap.has(b.id) ? 0 : 1;
    return ea - eb;
  });

  return (
    <AppShell active="badges">
      <div style={S.wrap}>
        <div style={S.head}>
          <div style={{ flex: 1 }}>
            <h1 style={S.h1}>Badges</h1>
            <p style={S.sub}>Milestones that prove your progress — not participation trophies.</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={S.count}>
              {earnedMap.size}
              <span style={{ color: "var(--text-muted)", fontSize: "var(--text-base)" }}>/{badges.length}</span>
            </div>
            <div style={S.countLabel}>earned</div>
          </div>
        </div>

        <div style={S.grid}>
          {sorted.map((b) => (
            <Tile key={b.id} b={b} earnedAt={earnedMap.get(b.id)} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function Tile({ b, earnedAt }: { b: BadgeRow; earnedAt: string | undefined }) {
  const isEarned = earnedAt !== undefined;
  return (
    <div
      style={{
        background: isEarned ? "linear-gradient(180deg, var(--brand-subtle), var(--surface))" : "var(--surface)",
        border: `2px solid ${isEarned ? "var(--brand-border)" : "var(--border)"}`,
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-solid)",
        padding: "20px 18px",
        textAlign: "center",
        position: "relative",
        opacity: isEarned ? 1 : 0.96,
      }}
    >
      {isEarned && (
        <span style={{ position: "absolute", top: 12, right: 12 }}>
          <Icon name="circle-check" size={18} style={{ color: "var(--success-text)" }} />
        </span>
      )}
      <div style={{ position: "relative", width: 64, height: 64, margin: "0 auto 14px" }}>
        <div
          style={{
            position: "absolute",
            inset: 8,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: isEarned ? "linear-gradient(165deg, var(--brand), var(--brand-active))" : "var(--surface-inset)",
            color: isEarned ? "var(--text-on-brand)" : "var(--text-disabled)",
            boxShadow: isEarned ? "var(--glow-brand)" : "none",
          }}
        >
          <Icon name={isEarned ? ((b.icon as IconName) || "trophy") : "lock"} size={24} strokeWidth={2.2} />
        </div>
      </div>
      <div style={S.name}>{b.name}</div>
      {b.description && <div style={S.desc}>{b.description}</div>}
      {earnedAt && (
        <div style={S.earnedAt}>Earned {new Date(earnedAt).toLocaleDateString("en-US")}</div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 980, margin: "0 auto", padding: "30px 28px 48px" },
  head: { display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 22 },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 4px" },
  sub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: 0 },
  count: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xl)", fontWeight: 600, color: "var(--brand)" },
  countLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 },
  name: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--text-primary)", marginBottom: 4 },
  desc: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.45, minHeight: 32 },
  earnedAt: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-link)", fontWeight: 600, marginTop: 10 },
};
