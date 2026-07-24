import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  computeStats,
  badgeProgress,
  type Criteria,
  type UserStats,
  type BadgeProgress,
} from "@/lib/progress/badges";
import { AppShell } from "../_AppShell";
import { Button } from "@/components/core/Button";
import { Icon, type IconName } from "@/components/core/icons";

export const dynamic = "force-dynamic";

interface BadgeRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  criteria: Criteria | null;
}

/** Уникальная Lucide-иконка на бейдж по стабильному `code` (в БД icon — эмодзи). */
const BADGE_ICON: Record<string, IconName> = {
  first_test: "footprints",
  tests_10: "dumbbell",
  tests_50: "route",
  streak_3: "zap",
  streak_7: "flame",
  streak_30: "shield",
  perfect: "sparkles",
  rating_1200: "star",
  rating_1500: "award",
  tfng_sniper: "target",
  completion_pro: "pencil-check",
  champion: "crown",
};
const iconFor = (code: string): IconName => BADGE_ICON[code] ?? "award";

interface ViewBadge {
  id: string;
  code: string;
  name: string;
  description: string | null;
  earnedAt: string | null;
  progress: BadgeProgress | null;
}

export default async function BadgesPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // badge: PUBLIC read RLS. user_badge: OWNER-ONLY read (user_id = auth.uid()),
  // so this only returns the logged-in user's own earned rows; the explicit
  // .eq("user_id") is defence-in-depth on top of RLS.
  const [{ data: badgeData }, { data: earnedData }] = await Promise.all([
    supabase.from("badge").select("id,code,name,description,criteria"),
    supabase.from("user_badge").select("badge_id,earned_at").eq("user_id", user.id),
  ]);

  const badges = (badgeData ?? []) as BadgeRow[];
  const earnedMap = new Map<string, string>(
    ((earnedData ?? []) as { badge_id: string; earned_at: string }[]).map((e) => [e.badge_id, e.earned_at]),
  );

  const hasLocked = badges.some((b) => !earnedMap.has(b.id));
  // Реальный прогресс для locked-бейджей — owner-путь (как в движке наград).
  const stats: UserStats | null = hasLocked ? await computeStats(user.id) : null;

  const view: ViewBadge[] = badges.map((b) => {
    const earnedAt = earnedMap.get(b.id) ?? null;
    const progress = !earnedAt && stats && b.criteria ? badgeProgress(b.criteria, stats) : null;
    return { id: b.id, code: b.code, name: b.name, description: b.description, earnedAt, progress };
  });

  const earned = view.filter((b) => b.earnedAt);
  const locked = view
    .filter((b) => !b.earnedAt)
    .sort((a, b) => (b.progress?.pct ?? 0) - (a.progress?.pct ?? 0));
  const next = locked[0] ?? null; // closest to unlocking

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
              {earned.length}
              <span style={{ color: "var(--text-muted)", fontSize: "var(--text-base)" }}>/{badges.length}</span>
            </div>
            <div style={S.countLabel}>earned</div>
          </div>
        </div>

        {/* Next-up spotlight — closest locked badge */}
        {next && next.progress && (
          <div style={S.hero}>
            <div style={{ position: "relative", width: 88, height: 88, flex: "none" }}>
              <Ring pct={next.progress.pct} size={88} color="var(--violet-300)" track="rgba(255,255,255,0.18)" />
              <div style={S.heroMedal}>
                <Icon name={iconFor(next.code)} size={32} strokeWidth={2.2} />
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={S.heroEyebrow}>Closest to unlocking</div>
              <div style={S.heroTitle}>{next.name}</div>
              <div style={S.heroDesc}>
                {next.description}
                {next.progress.hint ? (
                  <>
                    {" · "}
                    <b style={{ color: "#fff", fontFamily: "var(--font-mono)" }}>{next.progress.hint}</b>
                  </>
                ) : null}
              </div>
            </div>
            <Button href="/app/reading" trailingIcon="arrow-right" variant="secondary" style={{ flex: "none", color: "var(--brand-active)" }}>
              Keep going
            </Button>
          </div>
        )}

        {earned.length > 0 && (
          <>
            <div style={S.sech}>
              Earned <span style={S.sechCt}>{earned.length}</span>
            </div>
            <div style={{ ...S.grid, marginBottom: 26 }}>
              {earned.map((b) => (
                <Tile key={b.id} b={b} />
              ))}
            </div>
          </>
        )}

        {locked.length > 0 && (
          <>
            <div style={S.sech}>
              Locked <span style={S.sechCt}>{locked.length}</span>
            </div>
            <div style={S.grid}>
              {locked.map((b) => (
                <Tile key={b.id} b={b} />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

/* Progress ring — серверный SVG (без клиента), как кольцо band на дашборде. */
function Ring({ pct, size, color, track }: { pct: number; size: number; color: string; track?: string }) {
  const sw = 4;
  const r = (size - sw) / 2;
  const cx = size / 2;
  const C = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", inset: 0 }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={track ?? "var(--border)"} strokeWidth={sw} />
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - Math.max(0, Math.min(1, pct)))}
        transform={`rotate(-90 ${cx} ${cx})`}
      />
    </svg>
  );
}

function Tile({ b }: { b: ViewBadge }) {
  const isEarned = !!b.earnedAt;
  const pct = b.progress?.pct ?? 0;
  // Бейджи авто-выдаются на submit (ручного claim нет) — «почти готово» подсвечиваем
  // зелёным, без кнопки-обманки Claim.
  const ready = !isEarned && pct >= 0.85;
  const ringColor = ready ? "var(--success)" : "var(--brand)";
  return (
    <div
      style={{
        background: isEarned ? "linear-gradient(180deg, var(--brand-subtle), var(--surface))" : "var(--surface)",
        border: `2px solid ${isEarned ? "var(--brand-border)" : ready ? "var(--success)" : "var(--border)"}`,
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-solid)",
        padding: "20px 16px",
        textAlign: "center",
        position: "relative",
      }}
    >
      {isEarned && (
        <span style={{ position: "absolute", top: 12, right: 12 }}>
          <Icon name="circle-check" size={17} style={{ color: "var(--success-text)" }} />
        </span>
      )}
      <div style={{ position: "relative", width: 64, height: 64, margin: "0 auto 14px" }}>
        {!isEarned && <Ring pct={pct} size={64} color={ringColor} />}
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
          <Icon name={isEarned ? iconFor(b.code) : "lock"} size={24} strokeWidth={2.2} />
        </div>
      </div>
      <div style={S.name}>{b.name}</div>
      {b.description && <div style={S.desc}>{b.description}</div>}
      {isEarned ? (
        <div style={S.earnedAt}>Earned {new Date(b.earnedAt!).toLocaleDateString("en-US")}</div>
      ) : ready ? (
        <div style={{ ...S.hint, color: "var(--success-text)", fontWeight: 700 }}>Almost there — {b.progress?.hint}</div>
      ) : b.progress?.hint ? (
        <div style={S.hint}>{b.progress.hint}</div>
      ) : null}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 1000, margin: "0 auto", padding: "30px 28px 48px" },
  head: { display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 22 },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 4px" },
  sub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: 0 },
  count: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xl)", fontWeight: 600, color: "var(--brand)" },
  countLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },

  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "var(--radius-xl)",
    background: "linear-gradient(150deg, var(--slate-900), var(--slate-950))",
    color: "#fff",
    padding: "24px 26px",
    display: "flex",
    alignItems: "center",
    gap: 22,
    marginBottom: 24,
    boxShadow: "var(--shadow-md)",
  },
  heroMedal: { position: "absolute", inset: 10, borderRadius: "50%", display: "grid", placeItems: "center", background: "rgba(255,255,255,0.08)", color: "#fff" },
  heroEyebrow: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--violet-300)", fontWeight: 600 },
  heroTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", margin: "7px 0 3px" },
  heroDesc: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.78)" },

  sech: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 9 },
  sechCt: { fontFamily: "var(--font-mono)", color: "var(--text-disabled)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 },

  name: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--text-primary)", marginBottom: 4 },
  desc: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.45, minHeight: 32 },
  earnedAt: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-link)", fontWeight: 600, marginTop: 10 },
  hint: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-secondary)", marginTop: 9 },
};
