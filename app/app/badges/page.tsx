import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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

  const earnedMap = new Map<string, string>(
    earned.map((e) => [e.badge_id, e.earned_at]),
  );

  // Earned first, then locked; stable within each group by source order.
  const sorted = [...badges].sort((a, b) => {
    const ea = earnedMap.has(a.id) ? 0 : 1;
    const eb = earnedMap.has(b.id) ? 0 : 1;
    return ea - eb;
  });

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <Link href="/app" style={S.back}>
          ← Дашборд
        </Link>

        <h1 style={S.h1}>Бейджи</h1>
        <p style={S.count}>
          {earnedMap.size}/{badges.length} бейджей
        </p>

        <div style={S.grid}>
          {sorted.map((b) => {
            const earnedAt = earnedMap.get(b.id);
            const isEarned = earnedAt !== undefined;
            return (
              <div
                key={b.id}
                style={isEarned ? S.card : { ...S.card, ...S.cardLocked }}
              >
                <div
                  style={isEarned ? S.icon : { ...S.icon, ...S.iconLocked }}
                >
                  {b.icon ?? "🏅"}
                </div>
                <div style={S.name}>{b.name}</div>
                {b.description && <div style={S.desc}>{b.description}</div>}
                {isEarned && (
                  <div style={S.earnedAt}>
                    Получен{" "}
                    {new Date(earnedAt).toLocaleDateString("ru-RU")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", padding: "2rem 1.25rem 4rem", fontFamily: FONT },
  wrap: { maxWidth: 720, margin: "0 auto" },
  back: { color: "#6C5CE7", fontSize: ".9rem" },
  h1: { fontSize: "1.7rem", margin: "1rem 0 .25rem" },
  count: { color: "#888", margin: "0 0 1.5rem", fontWeight: 600 },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: ".75rem",
  },
  card: {
    background: "#fff",
    border: "1px solid #ececf1",
    borderRadius: 12,
    padding: "1.1rem .9rem",
    textAlign: "center",
  },
  cardLocked: {
    opacity: 0.55,
    background: "#fafafa",
  },
  icon: { fontSize: "2.4rem", lineHeight: 1 },
  iconLocked: { filter: "grayscale(1)" },
  name: { fontWeight: 700, fontSize: ".95rem", marginTop: ".5rem" },
  desc: {
    color: "#888",
    fontSize: ".78rem",
    marginTop: ".3rem",
    lineHeight: 1.4,
  },
  earnedAt: {
    color: "#6C5CE7",
    fontSize: ".72rem",
    fontWeight: 600,
    marginTop: ".5rem",
  },
};
