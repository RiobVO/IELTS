import { and, eq, gte } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { attempt } from "@/db/schema";
import {
  computeStats,
  badgeProgress,
  type Criteria,
  type BadgeProgress,
} from "@/lib/progress/badges";
import { AppShell } from "../_AppShell";
import { Button } from "@/components/core/Button";
import { Icon, type IconName } from "@/components/core/icons";
import { BadgesMotion } from "./BadgesMotion";

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

/** Бейджи сгруппированы в 4 трека-прогрессии (locked — следующий шаг, не «серый»). */
const TRACK_DEF: { key: string; name: string; icon: IconName; codes: string[] }[] = [
  { key: "consistency", name: "Consistency", icon: "flame", codes: ["streak_3", "streak_7", "streak_30"] },
  { key: "volume", name: "Volume", icon: "dumbbell", codes: ["first_test", "tests_10", "tests_50"] },
  { key: "mastery", name: "Mastery", icon: "target", codes: ["tfng_sniper", "completion_pro", "perfect"] },
  { key: "rating", name: "Rating", icon: "star", codes: ["rating_1200", "rating_1500", "champion"] },
];

const GOAL_TARGET = 5; // tests / week (фикс-дефолт; настройка — позже)

interface TrackNode {
  code: string;
  name: string;
  description: string | null;
  earnedAt: string | null;
  prog: BadgeProgress | null;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const heatLevel = [0, 30, 54, 78, 100];
const heatColor = (c: number) =>
  c === 0 ? "var(--surface-inset)" : `color-mix(in oklab, var(--brand) ${heatLevel[Math.min(c, 4)]}%, var(--surface-inset))`;
const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export default async function BadgesPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // 42-day window for the momentum heatmap / streak week / weekly goal.
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - 41);

  // badge: PUBLIC read RLS. user_badge: OWNER-ONLY read (RLS + explicit eq is
  // defence-in-depth). Activity is the user's own attempt timestamps (owner path,
  // server-only). All three run in parallel.
  const [{ data: badgeData }, { data: earnedData }, activityRows] = await Promise.all([
    supabase.from("badge").select("id,code,name,description,criteria"),
    supabase.from("user_badge").select("badge_id,earned_at").eq("user_id", user.id),
    db
      .select({ submittedAt: attempt.submittedAt })
      .from(attempt)
      .where(and(eq(attempt.userId, user.id), eq(attempt.status, "submitted"), gte(attempt.submittedAt, since))),
  ]);

  const badges = (badgeData ?? []) as BadgeRow[];
  const earnedMap = new Map<string, string>(
    ((earnedData ?? []) as { badge_id: string; earned_at: string }[]).map((e) => [e.badge_id, e.earned_at]),
  );
  // Stats power the locked-node progress rings + the streak number (owner path,
  // same source the awarding engine uses).
  const stats = await computeStats(user.id);

  // ---- Activity derivations (heatmap, streak week, weekly goal) ----
  const byDay = new Map<string, number>();
  for (const r of activityRows) {
    if (!r.submittedAt) continue;
    const k = dayKey(new Date(r.submittedAt));
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const heat: { count: number; label: string }[] = [];
  for (let i = 41; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const count = byDay.get(dayKey(d)) ?? 0;
    heat.push({ count, label: `${fmtDay(d)} · ${count ? `${count} test${count > 1 ? "s" : ""}` : "rest day"}` });
  }
  const activeDays = heat.filter((h) => h.count > 0).length;

  // Current week (Mon-anchored)
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayOffset);
  const WEEK_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
  let weeklyDone = 0;
  const week = WEEK_LABELS.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const count = byDay.get(dayKey(d)) ?? 0;
    if (d <= today) weeklyDone += count;
    const isToday = dayKey(d) === dayKey(today);
    const state = count > 0 ? "done" : isToday ? "today" : "idle";
    return { label, state, isToday };
  });
  const streak = stats.currentStreak;

  // ---- Tracks ----
  const byCode = new Map(badges.map((b) => [b.code, b]));
  const tracks = TRACK_DEF.map((def) => {
    const nodes: TrackNode[] = def.codes
      .map((code) => {
        const b = byCode.get(code);
        if (!b) return null;
        const earnedAt = earnedMap.get(b.id) ?? null;
        const prog = !earnedAt && b.criteria ? badgeProgress(b.criteria, stats) : null;
        return { code, name: b.name, description: b.description, earnedAt, prog };
      })
      .filter((n): n is TrackNode => n !== null);
    const notEarned = nodes.filter((n) => !n.earnedAt);
    const currentCode = notEarned.length
      ? notEarned.reduce((a, b) => ((b.prog?.pct ?? 0) > (a.prog?.pct ?? 0) ? b : a)).code
      : null;
    const earnedCount = nodes.filter((n) => n.earnedAt).length;
    const curPct = currentCode ? nodes.find((n) => n.code === currentCode)?.prog?.pct ?? 0 : 0;
    const fill = nodes.length ? (earnedCount + curPct) / nodes.length : 0;
    return { ...def, nodes, currentCode, fill, done: earnedCount };
  });

  const earnedTotal = badges.filter((b) => earnedMap.has(b.id)).length;
  // Next-up = closest-to-unlock current node across all tracks.
  const next = tracks
    .flatMap((t) => t.nodes.filter((n) => n.code === t.currentCode).map((n) => ({ node: n, track: t.name })))
    .filter((x) => x.node.prog)
    .sort((a, b) => (b.node.prog!.pct) - (a.node.prog!.pct))[0] ?? null;

  return (
    <AppShell active="badges">
      <style>{BDG_CSS}</style>
      <div data-badges-root className="bdg-wrap" style={S.wrap}>
        {/* Header */}
        <div style={S.head}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={S.h1}>Badges</h1>
            <p style={S.sub}>Milestones that prove your progress — not participation trophies.</p>
          </div>
          <div style={S.ringCount}>
            <Ring pct={earnedTotal / Math.max(1, badges.length)} size={64} color="var(--brand)" sw={5} />
            <b style={S.ringCountB}>
              <span data-countup={earnedTotal}>{earnedTotal}</span>
              <small style={{ fontSize: 11, color: "var(--text-secondary)" }}>/{badges.length}</small>
            </b>
          </div>
        </div>

        {/* Next-up spotlight */}
        {next && next.node.prog && (
          <div className="bdg-hero" style={S.hero}>
            <div className="bdg-hero-ring" style={S.heroRing}>
              <Ring pct={next.node.prog.pct} size={96} color="var(--violet-300)" sw={5} track="rgba(255,255,255,0.18)" />
              <div style={S.heroMedal}>
                <Icon name={iconFor(next.node.code)} size={32} strokeWidth={2.2} />
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0, position: "relative", zIndex: 1 }}>
              <div style={S.heroEyebrow}>Closest to unlocking · {next.track}</div>
              <h2 style={S.heroTitle}>{next.node.name}</h2>
              <div style={S.heroDesc}>
                You&apos;re <b style={S.heroB}>{Math.round(next.node.prog.pct * 100)}%</b> there
                {next.node.prog.hint ? (
                  <>
                    {" — "}
                    <b style={S.heroB}>{next.node.prog.hint}</b>
                  </>
                ) : null}
                . One more push and it&apos;s yours.
              </div>
            </div>
            <Button href="/app/reading" trailingIcon="arrow-right" variant="secondary" style={{ flex: "none", color: "var(--brand-active)" }}>
              Keep going
            </Button>
          </div>
        )}

        {/* Tracks + motivational sidebar */}
        <div className="bdg-cols">
          <div className="bdg-tracks">
            {tracks.map((t) => (
              <div key={t.key} style={S.track}>
                <div style={S.trackHead}>
                  <span style={S.trackIc}>
                    <Icon name={t.icon} size={16} strokeWidth={2.2} />
                  </span>
                  <h2 style={{ ...S.trackName, margin: 0 }}>{t.name}</h2>
                  <span style={S.trackMeta}>
                    {t.done} / {t.nodes.length}
                  </span>
                </div>
                <div style={S.rail}>
                  <div style={S.railBg} />
                  <div data-grow style={{ ...S.railFill, width: `${t.fill * 100}%` }} />
                  {t.nodes.map((n) => (
                    <Node key={n.code} n={n} current={n.code === t.currentCode} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <aside className="bdg-side" style={S.side}>
            {/* Streak keeper */}
            <div style={{ ...S.motCard, ...S.streakCard }}>
              <span style={S.flameGlow} />
              <h2 style={S.srOnly}>Streak</h2>
              <div style={S.streakTop}>
                <span className="bdg-flame" style={S.flame}>
                  <Icon name="flame" size={26} strokeWidth={2.2} />
                </span>
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div style={S.streakNum}>
                    <span data-countup={streak}>{streak}</span>
                  </div>
                  <div style={S.streakLbl}>day streak</div>
                </div>
              </div>
              <div style={S.streakWeek}>
                {week.map((d, i) => (
                  <div key={i} style={S.day}>
                    <span style={{ ...S.dayDot, ...(d.state === "done" ? S.dayDone : d.state === "today" ? S.dayToday : null) }}>
                      {d.state === "done" && <Icon name="check" size={13} strokeWidth={3} style={{ color: "#fff" }} />}
                    </span>
                    <span style={S.dayL}>{d.label}</span>
                  </div>
                ))}
              </div>
              <div style={S.streakNudge}>
                {streak > 0 ? (
                  <>
                    Sit one test today to reach <b style={S.gold}>{streak + 1} days</b> — don&apos;t break the chain.
                  </>
                ) : (
                  <>
                    Sit a test today to light your <b style={S.gold}>first streak</b>.
                  </>
                )}
              </div>
            </div>

            {/* Momentum heatmap */}
            <div style={S.motCard}>
              <h2 style={S.heatTitle}>Momentum</h2>
              <p style={S.heatSub}>Last 6 weeks · your practice rhythm</p>
              <div
                style={S.heatGrid}
                role="img"
                aria-label={`Practice heatmap, last 6 weeks. ${activeDays} active ${activeDays === 1 ? "day" : "days"}.`}
              >
                {heat.map((h, i) => (
                  <span
                    key={i}
                    data-heat={i}
                    data-tip={h.label}
                    aria-hidden="true"
                    className="bdg-heat-cell"
                    style={{ aspectRatio: "1", borderRadius: 4, background: heatColor(h.count) }}
                  />
                ))}
              </div>
              <div style={S.heatLegend} aria-hidden="true">
                <span>Less</span>
                {heatLevel.map((_, i) => (
                  <span key={i} style={{ width: 11, height: 11, borderRadius: 3, flex: "none", background: heatColor(i), boxShadow: "inset 0 0 0 1px var(--border)" }} />
                ))}
                <span>More</span>
              </div>
              <div style={S.heatFoot}>
                <span style={{ color: "var(--streak)", flex: "none", display: "inline-flex" }}>
                  <Icon name="flame" size={15} strokeWidth={2.2} />
                </span>
                <span>
                  <b style={S.heatB}>{activeDays}</b> active {activeDays === 1 ? "day" : "days"} in the last 6 weeks. Keep the rhythm.
                </span>
              </div>
            </div>

            {/* Weekly goal */}
            <div style={S.motCard}>
              <div style={S.goalRow}>
                <div style={S.goalRing}>
                  <Ring pct={Math.min(1, weeklyDone / GOAL_TARGET)} size={72} color="var(--brand)" sw={5} />
                  <b style={S.goalRingB}>
                    {Math.min(weeklyDone, GOAL_TARGET)}/{GOAL_TARGET}
                  </b>
                </div>
                <div style={{ minWidth: 0 }}>
                  <h2 style={S.goalH}>This week&apos;s goal</h2>
                  <p style={S.goalP}>
                    {weeklyDone >= GOAL_TARGET ? (
                      <>
                        <b style={{ color: "var(--success-text)" }}>Goal hit</b> — {weeklyDone} tests this week. Outstanding.
                      </>
                    ) : (
                      <>
                        <b style={{ color: "var(--brand-active)" }}>{GOAL_TARGET - weeklyDone} more</b> {GOAL_TARGET - weeklyDone === 1 ? "test" : "tests"} to hit your target. You&apos;ve got this.
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
      <BadgesMotion />
    </AppShell>
  );
}

/* Progress ring — server SVG; emits data-arc so the client island can draw it. */
function Ring({ pct, size, color, sw = 4, track }: { pct: number; size: number; color: string; sw?: number; track?: string }) {
  const r = (size - sw) / 2;
  const cx = size / 2;
  const C = 2 * Math.PI * r;
  const off = C * (1 - Math.max(0, Math.min(1, pct)));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", inset: 0 }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={track ?? "var(--surface-inset)"} strokeWidth={sw} />
      <circle
        data-arc
        data-c={C}
        data-off={off}
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={off}
        transform={`rotate(-90 ${cx} ${cx})`}
      />
    </svg>
  );
}

function Node({ n, current }: { n: TrackNode; current: boolean }) {
  const earned = !!n.earnedAt;
  const tip = earned
    ? `${n.name} — earned${n.earnedAt ? ` on ${new Date(n.earnedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}`
    : current
      ? `${n.name} — ${n.prog?.hint ?? "in progress"} · almost there`
      : `${n.name} — locked${n.prog?.hint ? ` · ${n.prog.hint}` : ""}`;
  const state = earned ? "earned" : current ? "current" : "locked";
  return (
    <div className="bdg-node" tabIndex={earned ? 0 : undefined} data-tip={tip} style={S.node}>
      <div style={{ ...S.medal, ...(earned ? S.medalEarned : current ? S.medalCurrent : S.medalLocked) }} data-pop={earned ? "" : undefined}>
        {current && n.prog && (
          <div style={{ position: "absolute", inset: -5 }}>
            <Ring pct={n.prog.pct} size={72} color="var(--brand)" sw={4} />
          </div>
        )}
        <Icon name={earned || current ? iconFor(n.code) : "lock"} size={24} strokeWidth={2.2} />
        {earned && (
          <span style={S.check}>
            <Icon name="check" size={12} strokeWidth={3} style={{ color: "#fff" }} />
          </span>
        )}
      </div>
      <span style={{ ...S.nodeName, ...(state === "locked" ? { color: "var(--text-muted)" } : null) }}>{n.name}</span>
      <span style={{ ...S.nodeTag, color: earned ? "var(--text-link)" : current ? "var(--brand-active)" : "var(--text-secondary)" }}>
        {earned ? "Earned" : n.prog?.hint ?? "Locked"}
      </span>
    </div>
  );
}

// Адаптив + интерактив (hover/keyframes) — в классах; брейкпоинт-свойства не inline.
const BDG_CSS = `
.bdg-wrap{padding:22px 16px 48px}
.bdg-cols{display:grid;grid-template-columns:1fr;gap:14px}
.bdg-hero{flex-wrap:wrap;padding:20px}
.bdg-flame{animation:bdg-flicker 2.6s ease-in-out infinite}
@keyframes bdg-flicker{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
.bdg-heat-cell{cursor:default;transition:transform .12s}
.bdg-heat-cell:hover{transform:scale(1.22)}
.bdg-node{cursor:default}
.bdg-node:focus-visible{outline:none;box-shadow:0 0 0 4px color-mix(in oklab,var(--brand) 28%,transparent);border-radius:var(--radius-md)}
.bdg-tip{position:fixed;z-index:90;pointer-events:none;background:var(--surface-inverse);color:var(--surface-inverse-ink);font-size:var(--text-xs);font-weight:600;line-height:1.4;padding:8px 11px;border-radius:10px;box-shadow:var(--shadow-lg);max-width:240px;opacity:0;transform:translateY(4px);transition:opacity .14s,transform .14s var(--ease-out)}
.bdg-tip.show{opacity:1;transform:translateY(0)}
.bdg-tip::after{content:"";position:absolute;left:50%;top:100%;transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--surface-inverse)}
.bdg-tip.below::after{top:auto;bottom:100%;border-top-color:transparent;border-bottom-color:var(--surface-inverse)}
@media (min-width:560px){ .bdg-hero{flex-wrap:nowrap;padding:24px 26px} }
@media (min-width:900px){
  .bdg-wrap{padding:30px 28px 56px}
  .bdg-cols{grid-template-columns:1.65fr 1fr;align-items:start}
  .bdg-side{position:sticky;top:78px}
}
@media (prefers-reduced-motion:reduce){
  .bdg-flame{animation:none}
  .bdg-heat-cell{transition:none}
  .bdg-tip{transition:none}
}
`;

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 1080, margin: "0 auto" },
  head: { display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 22 },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 4px" },
  sub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: 0 },
  ringCount: { position: "relative", width: 64, height: 64, flex: "none", display: "grid", placeItems: "center" },
  ringCountB: { position: "relative", fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--brand)", display: "flex", alignItems: "baseline", gap: 1 },

  hero: { position: "relative", overflow: "hidden", borderRadius: "var(--radius-2xl)", background: "linear-gradient(150deg, var(--surface-inverse), var(--surface-inverse-deep))", color: "var(--surface-inverse-ink)", display: "flex", alignItems: "center", gap: 22, marginBottom: 26, boxShadow: "var(--shadow-lg)" },
  heroRing: { position: "relative", width: 96, height: 96, flex: "none", zIndex: 1 },
  heroMedal: { position: "absolute", inset: 11, borderRadius: "50%", display: "grid", placeItems: "center", background: "rgba(255,255,255,0.08)", color: "var(--surface-inverse-ink)" },
  heroEyebrow: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", letterSpacing: "var(--tracking-snug)", color: "var(--violet-300)", fontWeight: 600 },
  heroTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", margin: "7px 0 4px" },
  heroDesc: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.8)", lineHeight: 1.5 },
  heroB: { color: "var(--surface-inverse-ink)", fontFamily: "var(--font-mono)" },

  track: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "18px 22px", marginBottom: 14, boxShadow: "var(--shadow-sm)" },
  trackHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 20 },
  trackIc: { width: 30, height: 30, flex: "none", borderRadius: 9, display: "grid", placeItems: "center", background: "var(--brand-subtle)", color: "var(--brand)" },
  trackName: { fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: "var(--text-base)", color: "var(--text-primary)" },
  trackMeta: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" },

  rail: { position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "0 6px" },
  railBg: { position: "absolute", left: 38, right: 38, top: 31, height: 4, borderRadius: "var(--radius-full)", background: "var(--surface-inset)" },
  railFill: { position: "absolute", left: 38, top: 31, height: 4, borderRadius: "var(--radius-full)", background: "linear-gradient(90deg, var(--brand), var(--brand-hover))", transformOrigin: "left", boxShadow: "0 0 12px -2px color-mix(in oklab, var(--brand) 80%, transparent)", maxWidth: "calc(100% - 76px)" },
  node: { position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "33%", minWidth: 0, textAlign: "center" },
  medal: { width: 62, height: 62, borderRadius: "50%", display: "grid", placeItems: "center", position: "relative" },
  medalEarned: { background: "linear-gradient(165deg, var(--brand), var(--brand-active))", color: "var(--text-on-brand)", boxShadow: "var(--glow-brand)" },
  medalCurrent: { background: "var(--surface)", color: "var(--brand)" },
  medalLocked: { background: "var(--surface-inset)", color: "var(--text-disabled)", border: "2px dashed var(--border-strong)" },
  check: { position: "absolute", right: -2, bottom: -2, width: 22, height: 22, borderRadius: "50%", background: "var(--success)", display: "grid", placeItems: "center", border: "2px solid var(--surface)" },
  nodeName: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)" },
  nodeTag: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", fontWeight: 600 },

  side: { display: "flex", flexDirection: "column", gap: 14 },
  motCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "18px 20px", boxShadow: "var(--shadow-sm)" },
  streakCard: { position: "relative", overflow: "hidden", background: "linear-gradient(165deg, var(--surface-premium), var(--surface-premium-deep))", color: "var(--surface-premium-ink)", border: 0 },
  flameGlow: { position: "absolute", left: -40, top: -46, width: 170, height: 170, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in oklab, var(--orange-500) 55%, transparent), transparent 70%)", pointerEvents: "none" },
  streakTop: { display: "flex", alignItems: "center", gap: 14, position: "relative", zIndex: 1 },
  flame: { width: 54, height: 54, flex: "none", borderRadius: 14, display: "grid", placeItems: "center", background: "linear-gradient(165deg, var(--orange-500), var(--streak))", color: "var(--surface-premium-ink)", boxShadow: "0 0 30px -4px color-mix(in oklab, var(--orange-500) 85%, transparent)" },
  streakNum: { fontFamily: "var(--font-mono)", fontSize: 34, fontWeight: 700, lineHeight: 1 },
  streakLbl: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "rgba(255,255,255,0.72)", textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", fontWeight: 700, marginTop: 3 },
  streakWeek: { display: "flex", gap: 6, margin: "16px 0 13px", position: "relative", zIndex: 1 },
  day: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 },
  dayDot: { width: "100%", height: 30, borderRadius: 8, background: "rgba(255,255,255,0.10)", display: "grid", placeItems: "center" },
  dayDone: { background: "linear-gradient(165deg, var(--orange-500), var(--streak))" },
  dayToday: { background: "rgba(255,255,255,0.14)", boxShadow: "inset 0 0 0 1.5px var(--gold-500)" },
  dayL: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "rgba(255,255,255,0.7)", fontWeight: 700 },
  streakNudge: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.92)", position: "relative", zIndex: 1, lineHeight: 1.45 },
  gold: { color: "var(--gold-500)" },

  heatTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 800, color: "var(--text-primary)", margin: "0 0 3px" },
  heatSub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-secondary)", margin: "0 0 14px" },
  heatGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 },
  heatLegend: { display: "flex", alignItems: "center", gap: 4, marginTop: 10, fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-secondary)" },
  heatFoot: { display: "flex", alignItems: "center", gap: 8, marginTop: 13, fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.4 },
  heatB: { color: "var(--text-primary)", fontFamily: "var(--font-mono)" },

  goalRow: { display: "flex", alignItems: "center", gap: 16 },
  goalRing: { position: "relative", width: 72, height: 72, flex: "none", display: "grid", placeItems: "center" },
  goalRingB: { position: "relative", fontFamily: "var(--font-mono)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--brand)" },
  goalH: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 800, color: "var(--text-primary)", margin: "0 0 3px" },
  goalP: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-secondary)", margin: 0, lineHeight: 1.45 },

  srOnly: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 },
};
